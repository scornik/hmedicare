import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' as hm;
import 'package:hm_auth/hm_auth.dart';
import 'active_tenant.dart';

/// Keys stay in this form only until an explicit save. No read cache or persisted state.
class DoctorAiAccountsScreen extends ConsumerStatefulWidget {
  const DoctorAiAccountsScreen({super.key});
  @override
  ConsumerState<DoctorAiAccountsScreen> createState() => _DoctorAiAccountsScreenState();
}

class _DoctorAiAccountsScreenState extends ConsumerState<DoctorAiAccountsScreen> {
  final _secret = TextEditingController();
  hm.MyAiCredentialList? _own;
  hm.TenantAiPolicy? _policy;
  List<hm.AiAcknowledgementText> _texts = [];
  String? _tenant, _provider, _notice;
  String _tier = 'PAID', _locale = '';
  bool _busy = false, _failed = false, _agree = false, _uncertain = false;
  int _scope = 0;
  String say(String en, String bn) => Localizations.localeOf(context).languageCode == 'bn' ? bn : en;
  bool same(String tenant, [int? scope]) =>
      mounted && ref.read(activeTenantProvider) == tenant && (scope == null || scope == _scope);

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _secret.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (!mounted) return;
    final scope = _scope;
    final tenant = ref.read(activeTenantProvider);
    _secret.clear();
    if (tenant == null) return;
    setState(() {
      _tenant = tenant;
      _busy = true;
      _own = null;
      _policy = null;
      _texts = [];
      _agree = false;
      _failed = false;
    });
    try {
      final ai = ref.read(apiClientProvider).ai;
      final own = await ai.listMyAiCredentials(xTenantId: tenant);
      final policy = await ai.getTenantAiPolicy(xTenantId: tenant);
      final texts = await ai.listAiAcknowledgementTexts(xTenantId: tenant);
      if (!same(tenant, scope)) return;
      setState(() {
        _own = own.data;
        _policy = policy.data;
        _texts = texts.data.items;
        _uncertain = false;
      });
    } catch (_) {
      if (same(tenant, scope)) {
        setState(() {
          _failed = true;
          _own = null;
          _policy = null;
          _texts = [];
        });
      }
    } finally {
      if (same(tenant, scope)) setState(() => _busy = false);
    }
  }

  Future<void> _write(Future<void> Function(String tenant, String doctor) action) async {
    final scope = _scope;
    final tenant = _tenant, own = _own;
    if (_busy || _uncertain || _failed || tenant == null || own == null || !same(tenant)) return;
    setState(() {
      _busy = true;
      _notice = null;
    });
    try {
      await action(tenant, own.doctorProfileId);
      if (!same(tenant, scope)) return;
      setState(
        () => _notice = say(
          'Account updated. Refresh to check validation status.',
          'অ্যাকাউন্ট আপডেট হয়েছে। যাচাইয়ের অবস্থা দেখতে রিফ্রেশ করুন।',
        ),
      );
      await _load();
    } catch (_) {
      if (!same(tenant, scope)) return;
      setState(() {
        _uncertain = true;
        _notice = say(
          'The update could not be confirmed. Refresh before another change. Your key has been cleared.',
          'আপডেট নিশ্চিত করা যায়নি। আরেকটি পরিবর্তনের আগে রিফ্রেশ করুন। আপনার কী মুছে ফেলা হয়েছে।',
        );
      });
    } finally {
      if (same(tenant, scope)) {
        _secret.clear();
        setState(() {
          _busy = false;
          _agree = false;
        });
      }
    }
  }

  Future<void> _save(hm.AiAcknowledgementText text) async {
    final scope = _scope;
    final provider = _provider, key = _secret.text, tier = _tier, locale = _locale;
    if (!_agree ||
        provider == null ||
        key.length < 16 ||
        key.length > 512 ||
        !(_policy?.allowedProviderCodes.contains(provider) ?? false)) {
      return;
    }
    _secret.clear();
    await _write((tenant, doctor) async {
      final ai = ref.read(apiClientProvider).ai;
      final acknowledgement = await ai.recordAiAcknowledgement(
        xTenantId: tenant,
        idempotencyKey: newIdempotencyKey(),
        body: hm.RecordAiAcknowledgementRequest(
          doctorProfileId: doctor,
          locale: hm.RecordAiAcknowledgementRequestLocale.fromJson(locale),
          providerCode: provider,
          termsTextVersion: text.version,
          tier: hm.RecordAiAcknowledgementRequestTier.fromJson(tier),
        ),
      );
      if (!same(tenant, scope)) return;
      await ai.createAiCredential(
        id: doctor,
        xTenantId: tenant,
        idempotencyKey: newIdempotencyKey(),
        body: hm.CreateAiCredentialRequest(
          billingMode: tier == 'FREE'
              ? hm.CreateAiCredentialRequestBillingMode.doctorByokFree
              : hm.CreateAiCredentialRequestBillingMode.doctorByokPaid,
          declaredTier: hm.CreateAiCredentialRequestDeclaredTier.fromJson(tier),
          providerCode: provider,
          secret: key,
          dataUseAckId: acknowledgement.data.id,
        ),
      );
    });
  }

  Future<void> _change(hm.AiCredential credential, hm.ChangeAiCredentialRequestAction action) =>
      _write((tenant, doctor) async {
        await ref
            .read(apiClientProvider)
            .ai
            .changeAiCredential(
              doctorId: doctor,
              id: credential.id,
              xTenantId: tenant,
              idempotencyKey: newIdempotencyKey(),
              body: hm.ChangeAiCredentialRequest(action: action, expectedRowVersion: credential.rowVersion),
            );
      });

  @override
  Widget build(BuildContext context) {
    final tenant = ref.watch(activeTenantProvider);
    ref.listen(activeTenantProvider, (_, next) {
      _scope++;
      _secret.clear();
      setState(() {
        _tenant = next;
        _own = null;
        _policy = null;
        _texts = [];
        _provider = null;
        _notice = null;
        _agree = false;
        _busy = false;
        _uncertain = false;
      });
      Future.microtask(_load);
    });
    final locale = Localizations.localeOf(context).languageCode == 'bn' ? 'bn-BD' : 'en-BD';
    if (_locale != locale) {
      _locale = locale;
      _agree = false;
      _secret.clear();
    }
    hm.AiAcknowledgementText? text;
    for (final item in _texts) {
      if (item.locale.json == locale && item.tier.json == _tier) {
        text = item;
        break;
      }
    }
    final statement = text, ready = !_busy && !_uncertain && !_failed;
    final policy = _policy, own = _own;
    return Scaffold(
      appBar: AppBar(title: Text(say('My AI accounts', 'আমার এআই অ্যাকাউন্ট'))),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            say(
              'Use your own provider account. Keys are encrypted; only their last four characters are shown later.',
              'নিজের প্রোভাইডার অ্যাকাউন্ট ব্যবহার করুন। কী এনক্রিপ্ট করা হয়; পরে শুধু শেষ চারটি অক্ষর দেখানো হয়।',
            ),
          ),
          TextButton(
            onPressed: _busy || tenant == null
                ? null
                : () {
                    setState(() => _notice = null);
                    _load();
                  },
            child: Text(say('Refresh accounts', 'অ্যাকাউন্ট রিফ্রেশ করুন')),
          ),
          if (_notice != null) Text(_notice!, key: const Key('ai-account-notice')),
          if (tenant == null) Text(say('Choose a clinic first.', 'আগে একটি ক্লিনিক বেছে নিন।')),
          if (_busy) const LinearProgressIndicator(),
          if (_failed)
            Text(
              say(
                'Current account settings could not be loaded. Refresh to try again.',
                'বর্তমান অ্যাকাউন্ট সেটিংস লোড করা যায়নি। আবার রিফ্রেশ করুন।',
              ),
              key: const Key('ai-account-error'),
            ),
          if (policy != null && own != null && tenant == _tenant) ...[
            if (!policy.aiEnabled)
              Text(
                say(
                  'AI assistance is currently off for this clinic. You can prepare your account.',
                  'এই ক্লিনিকে এআই সহায়তা বর্তমানে বন্ধ। আপনি অ্যাকাউন্ট প্রস্তুত রাখতে পারেন।',
                ),
              ),
            DropdownButtonFormField<String>(
              key: ValueKey('provider:$_provider'),
              initialValue: policy.allowedProviderCodes.contains(_provider) ? _provider : null,
              isExpanded: true,
              decoration: InputDecoration(labelText: say('Provider', 'প্রোভাইডার')),
              items: policy.allowedProviderCodes
                  .map((code) => DropdownMenuItem(value: code, child: Text(code)))
                  .toList(),
              onChanged: ready
                  ? (value) {
                      _secret.clear();
                      setState(() {
                        _provider = value;
                        _agree = false;
                      });
                    }
                  : null,
            ),
            if (policy.allowedProviderCodes.isEmpty)
              Text(
                say(
                  'Ask the clinic owner to allow a provider first.',
                  'আগে ক্লিনিকের মালিককে একটি প্রোভাইডার অনুমোদন করতে বলুন।',
                ),
              ),
            DropdownButtonFormField<String>(
              initialValue: _tier,
              decoration: InputDecoration(labelText: say('Account tier', 'অ্যাকাউন্টের স্তর')),
              items: [
                DropdownMenuItem(value: 'PAID', child: Text(say('Paid', 'পেইড'))),
                DropdownMenuItem(value: 'FREE', child: Text(say('Free', 'বিনামূল্যে'))),
              ],
              onChanged: ready
                  ? (value) {
                      if (value == null) return;
                      _secret.clear();
                      setState(() {
                        _tier = value;
                        _agree = false;
                      });
                    }
                  : null,
            ),
            if (_tier == 'FREE' && !policy.freeTierEffective)
              Text(
                say(
                  'Free-tier use is currently blocked. Saving an account does not enable its use.',
                  'বিনামূল্যের স্তর ব্যবহার বর্তমানে বন্ধ। অ্যাকাউন্ট সংরক্ষণ করলে ব্যবহার চালু হবে না।',
                ),
              ),
            if (statement != null) ...[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: SelectableText(statement.body),
              ),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _agree,
                onChanged: ready ? (value) => setState(() => _agree = value ?? false) : null,
                title: Text(
                  say(
                    'I have read and accept this data-use statement for this provider and tier.',
                    'এই প্রোভাইডার ও স্তরের জন্য ডেটা ব্যবহারের বিবৃতি পড়েছি এবং মেনে নিচ্ছি।',
                  ),
                ),
              ),
            ] else
              Text(
                say(
                  'The current data-use statement is unavailable.',
                  'বর্তমান ডেটা ব্যবহারের বিবৃতি পাওয়া যাচ্ছে না।',
                ),
              ),
            TextField(
              key: const Key('ai-api-key'),
              controller: _secret,
              obscureText: true,
              autocorrect: false,
              enableSuggestions: false,
              onChanged: (_) => setState(() {}),
              maxLength: 512,
              enabled: ready,
              decoration: InputDecoration(
                labelText: say('API key (write-only)', 'এপিআই কী (শুধু লেখার জন্য)'),
              ),
            ),
            FilledButton(
              onPressed:
                  ready &&
                      _agree &&
                      _provider != null &&
                      statement != null &&
                      _secret.text.length >= 16 &&
                      _secret.text.length <= 512
                  ? () => _save(statement)
                  : null,
              child: Text(say('Save account', 'অ্যাকাউন্ট সংরক্ষণ করুন')),
            ),
            Text(say('Saved accounts', 'সংরক্ষিত অ্যাকাউন্ট'), style: Theme.of(context).textTheme.titleLarge),
            if (own.items.isEmpty)
              Text(say('No AI account saved yet.', 'এখনও কোনো এআই অ্যাকাউন্ট সংরক্ষিত নেই।')),
            for (final credential in own.items)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${credential.providerCode} · ${credential.declaredTier.json}'),
                      Text('${credential.status.json} · …${credential.secretLast4 ?? '—'}'),
                      if (credential.lastErrorClass != null)
                        Text(
                          '${say('Latest validation result', 'যাচাইয়ের সর্বশেষ ফল')}: ${credential.lastErrorClass}',
                        ),
                      if (credential.status != hm.AiCredentialStatus.revoked)
                        Wrap(
                          spacing: 8,
                          children: [
                            TextButton(
                              onPressed: ready
                                  ? () => _change(credential, hm.ChangeAiCredentialRequestAction.revalidate)
                                  : null,
                              child: Text(say('Request validation', 'যাচাইয়ের অনুরোধ করুন')),
                            ),
                            TextButton(
                              onPressed: ready
                                  ? () => _change(
                                      credential,
                                      credential.status == hm.AiCredentialStatus.disabled
                                          ? hm.ChangeAiCredentialRequestAction.enable
                                          : hm.ChangeAiCredentialRequestAction.disable,
                                    )
                                  : null,
                              child: Text(
                                credential.status == hm.AiCredentialStatus.disabled
                                    ? say('Enable', 'চালু করুন')
                                    : say('Disable', 'বন্ধ করুন'),
                              ),
                            ),
                            TextButton(
                              onPressed: ready
                                  ? () => _change(credential, hm.ChangeAiCredentialRequestAction.revoke)
                                  : null,
                              child: Text(say('Revoke', 'প্রত্যাহার করুন')),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}
