import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_design/hm_design.dart';
import 'package:hm_localization/hm_localization.dart';

/// Phone → OTP sign-in. Resend stays disabled for 30 s and is never automatic (MOBILE-IMPLEMENTATION §7).
class PatientLoginScreen extends ConsumerStatefulWidget {
  const PatientLoginScreen({super.key});

  static const resendLock = Duration(seconds: 30);

  @override
  ConsumerState<PatientLoginScreen> createState() => _PatientLoginScreenState();
}

class _PatientLoginScreenState extends ConsumerState<PatientLoginScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  String? _phoneE164;
  OtpHint? _hint;
  bool _busy = false;
  String? _errorKey;
  bool _resendLocked = false;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() f) async {
    setState(() {
      _busy = true;
      _errorKey = null;
    });
    try {
      await f();
    } on Exception {
      if (mounted) setState(() => _errorKey = 'loginFailed');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestCode() async {
    final e164 = normalizeBdMobile(_phone.text);
    if (e164 == null) {
      setState(() => _errorKey = 'invalidPhone');
      return;
    }
    await _run(() async {
      final hint = await ref
          .read(authControllerProvider.notifier)
          .requestOtp(e164, apiLocaleTag(ref.read(localeProvider)));
      setState(() {
        _phoneE164 = e164;
        _hint = hint;
        _resendLocked = true;
      });
      _timer?.cancel();
      _timer = Timer(PatientLoginScreen.resendLock, () {
        if (mounted) setState(() => _resendLocked = false);
      });
    });
  }

  Future<void> _verify() => _run(() async {
    await ref.read(authControllerProvider.notifier).verifyOtp(_phoneE164!, toLatinDigits(_code.text.trim()));
    _code.clear();
  });

  static String _hintKey(OtpHint h) => switch (h) {
    OtpHint.sent => 'hintSENT',
    OtpHint.retryLater => 'hintRETRY_LATER',
    OtpHint.mayArrive => 'hintMAY_ARRIVE',
  };

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final sent = _phoneE164 != null;
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('patientApp')),
        actions: [
          TextButton(
            onPressed: () => ref.read(localeProvider.notifier).toggle(),
            child: Text(s.t('language')),
          ),
        ],
      ),
      body: HmFormColumn(
        children: [
          Text(s.t('loginTitle'), style: Theme.of(context).textTheme.headlineSmall),
          TextField(
            key: const Key('phone'),
            controller: _phone,
            enabled: !sent,
            keyboardType: TextInputType.phone,
            autofillHints: const [AutofillHints.telephoneNumber],
            decoration: InputDecoration(labelText: s.t('phone'), hintText: '01XXXXXXXXX'),
          ),
          if (!sent)
            FilledButton(
              key: const Key('sendCode'),
              onPressed: _busy ? null : _requestCode,
              child: Text(s.t('sendCode')),
            ),
          if (_hint != null) Text(s.t(_hintKey(_hint!)), key: const Key('hint')),
          if (sent) ...[
            TextField(
              key: const Key('code'),
              controller: _code,
              keyboardType: TextInputType.number,
              maxLength: 6,
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: InputDecoration(labelText: s.t('code')),
            ),
            FilledButton(
              key: const Key('verify'),
              onPressed: _busy ? null : _verify,
              child: Text(s.t('verify')),
            ),
            TextButton(
              key: const Key('resend'),
              onPressed: _busy || _resendLocked ? null : _requestCode,
              child: Text(s.t('resendCode')),
            ),
          ],
          if (_errorKey != null)
            Text(s.t(_errorKey!), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
      ),
    );
  }
}
