import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' as hm;
import 'package:hm_auth/hm_auth.dart';
import 'active_tenant.dart';

/// Online-only assistance. Drafts, keys and job output never enter the read cache.
class DoctorAiPanel extends ConsumerStatefulWidget {
  const DoctorAiPanel({
    super.key,
    required this.encounterId,
    required this.canWrite,
    required this.noteRowVersion,
    required this.onBusy,
    required this.onApproved,
    required this.needsChartRefresh,
    this.initialJobId,
    this.onJobCreated,
    this.onHistory,
  });
  final String encounterId;
  final bool canWrite, needsChartRefresh;
  final int? noteRowVersion;
  final ValueChanged<bool> onBusy;
  final Future<void> Function() onApproved;
  final String? initialJobId;
  final ValueChanged<String>? onJobCreated;
  final VoidCallback? onHistory;
  @override
  ConsumerState<DoctorAiPanel> createState() => _DoctorAiPanelState();
}

class _DoctorAiPanelState extends ConsumerState<DoctorAiPanel> {
  List<hm.AiCredential> _credentials = [];
  List<hm.AiModel> _models = [];
  List<hm.AiJob> _historyJobs = [];
  hm.AiCredential? _credential;
  String? _modelId, _tenant, _error, _jobId;
  hm.AiJob? _job;
  hm.AiDraft? _draft;
  bool _enabled = false, _busy = false, _refreshing = false, _history = false;
  bool _historyLoaded = false;
  Timer? _poll;
  String say(String en, String bn) => Localizations.localeOf(context).languageCode == 'bn' ? bn : en;
  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final tenant = ref.read(activeTenantProvider);
    if (tenant == null) return;
    try {
      final api = ref.read(apiClientProvider);
      final policy = await api.ai.getTenantAiPolicy(xTenantId: tenant);
      if (!policy.data.aiEnabled) {
        if (mounted) setState(() => _enabled = false);
        return;
      }
      final credentials = await api.ai.listMyAiCredentials(xTenantId: tenant);
      final active = credentials.data.items.where((c) => c.status == hm.AiCredentialStatus.active).toList();
      if (!mounted || ref.read(activeTenantProvider) != tenant) return;
      setState(() {
        _tenant = tenant;
        _credentials = active;
        _credential = active.isEmpty ? null : active.first;
        _enabled = active.isNotEmpty;
      });
      if (_credential != null) await _loadModels();
      if (_credential != null) {
        final history = await api.ai.listEncounterAiJobs(id: widget.encounterId, xTenantId: tenant);
        if (mounted && ref.read(activeTenantProvider) == tenant) {
          setState(() {
            _historyJobs = history.data.items;
            _historyLoaded = true;
          });
        }
      }
      if (mounted && widget.initialJobId != null) {
        _jobId = widget.initialJobId;
        await _refresh();
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _enabled = false;
          _job = null;
          _draft = null;
        });
      }
    }
  }

  Future<void> _loadModels() async {
    final c = _credential, tenant = _tenant;
    if (c == null || tenant == null) return;
    setState(() {
      _models = [];
      _modelId = null;
    });
    final response = await ref
        .read(apiClientProvider)
        .ai
        .listAiModels(xTenantId: tenant, providerCode: c.providerCode);
    if (!mounted || _credential?.id != c.id || ref.read(activeTenantProvider) != tenant) return;
    setState(() {
      _models = response.data.items
          .where(
            (m) =>
                m.capabilities.contains('text') &&
                m.capabilities.contains('json_schema') &&
                m.tierAvailability.any((t) => t.name == c.declaredTier.name),
          )
          .toList();
    });
  }

  Future<void> _refresh() async {
    if (_refreshing || _jobId == null || _tenant == null) return;
    _refreshing = true;
    try {
      final api = ref.read(apiClientProvider), tenant = _tenant!;
      final job = (await api.ai.getAiJob(id: _jobId!, xTenantId: tenant)).data;
      if (job.encounterId != widget.encounterId) throw StateError('scope');
      hm.AiDraft? draft;
      if (job.draftId != null) {
        draft = (await api.ai.getAiDraft(id: job.draftId!, xTenantId: tenant)).data;
        if (draft.encounterId != widget.encounterId || draft.aiJobId != job.id) throw StateError('scope');
      }
      if (!mounted || ref.read(activeTenantProvider) != tenant) return;
      setState(() {
        _job = job;
        _draft = draft;
        _historyJobs = [job, ..._historyJobs.where((previous) => previous.id != job.id)].take(20).toList();
      });
      _poll?.cancel();
      if ([
        hm.AiJobStatus.queued,
        hm.AiJobStatus.running,
        hm.AiJobStatus.waitingRateLimit,
      ].contains(job.status)) {
        _poll = Timer(const Duration(seconds: 2), () {
          if (mounted) unawaited(_act(_refresh));
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _draft = null;
          _job = null;
        });
      }
      rethrow;
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _act(Future<void> Function() fn, {bool clinical = false}) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    if (clinical) widget.onBusy(true);
    var committed = false;
    try {
      await fn();
      committed = true;
      if (clinical) {
        await widget.onApproved();
        await _refresh();
      }
    } catch (error) {
      if (clinical &&
          !committed &&
          (error is! DioException || error.response == null || (error.response?.statusCode ?? 500) >= 500)) {
        try {
          await widget.onApproved();
          await _refresh();
        } catch (_) {
          /* Keep the chart locked when its state is unknown. */
        }
      }
      if (mounted) {
        setState(() {
          _error = clinical && committed
              ? say(
                  'Approval saved. Reload the chart before editing.',
                  'অনুমোদন সংরক্ষিত হয়েছে। সম্পাদনার আগে রেকর্ড আবার লোড করুন।',
                )
              : say(
                  'The action could not be confirmed. Refresh the review before continuing.',
                  'কাজটির ফল নিশ্চিত করা যায়নি। এগিয়ে যাওয়ার আগে পর্যালোচনা রিফ্রেশ করুন।',
                );
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
      if (clinical) widget.onBusy(false);
    }
  }

  Future<void> _request() async {
    final body = hm.CreateAiJobRequest(
      credentialId: _credential!.id,
      modelId: _modelId,
      sourceSelection: const hm.SourceSelection(draftSections: []),
    );
    final api = ref.read(apiClientProvider), tenant = _tenant!;
    final job = _history
        ? (await api.ai.createAiHistorySummaryJob(
            id: widget.encounterId,
            xTenantId: tenant,
            idempotencyKey: newIdempotencyKey(),
            body: body,
          )).data
        : (await api.ai.createAiNoteDraftJob(
            id: widget.encounterId,
            xTenantId: tenant,
            idempotencyKey: newIdempotencyKey(),
            body: body,
          )).data;
    if (!mounted || ref.read(activeTenantProvider) != tenant) return;
    setState(() {
      _jobId = job.id;
      _job = job;
      _draft = null;
    });
    widget.onJobCreated?.call(job.id);
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    if (!_enabled) return const SizedBox.shrink();
    final job = _job, draft = _draft;
    final reviewable =
        draft != null &&
        draft.expiresAt.isAfter(DateTime.now()) &&
        [hm.AiDraftStatus.readyForReview, hm.AiDraftStatus.inReview].contains(draft.status);
    final pending =
        (_jobId != null && job == null) ||
        (job != null &&
            [
              hm.AiJobStatus.queued,
              hm.AiJobStatus.running,
              hm.AiJobStatus.waitingRateLimit,
            ].contains(job.status));
    return Card(
      key: const Key('aiPanel'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (widget.onHistory != null)
              TextButton(
                onPressed: widget.onHistory,
                child: Text(
                  say(
                    'Review cited records in patient history',
                    'রোগীর ইতিহাসে উদ্ধৃত রেকর্ড পর্যালোচনা করুন',
                  ),
                ),
              ),
            if (_historyJobs.isNotEmpty)
              ExpansionTile(
                title: Text(say('Recent AI requests', 'সাম্প্রতিক AI অনুরোধ')),
                children: _historyJobs
                    .map(
                      (previous) => ListTile(
                        title: Text('${previous.purpose.name} · ${previous.status.name}'),
                        subtitle: Text(previous.providerCode),
                        onTap: _busy
                            ? null
                            : () => unawaited(
                                _act(() async {
                                  _jobId = previous.id;
                                  widget.onJobCreated?.call(previous.id);
                                  await _refresh();
                                }),
                              ),
                      ),
                    )
                    .toList(),
              ),
            Text(say('AI assistance', 'AI সহায়তা'), style: Theme.of(context).textTheme.titleLarge),
            Text(
              say(
                'Each suggestion needs your review and approval. Patient consent is checked by the server.',
                'প্রতিটি প্রস্তাব আপনার পর্যালোচনা ও অনুমোদন প্রয়োজন। সার্ভার রোগীর সম্মতি যাচাই করবে।',
              ),
            ),
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: _credential?.id,
              decoration: InputDecoration(labelText: say('Credential', 'ক্রেডেনশিয়াল')),
              items: _credentials
                  .map(
                    (c) => DropdownMenuItem(
                      value: c.id,
                      child: Text('${c.providerCode} · ${c.declaredTier.name} · …${c.secretLast4 ?? ''}'),
                    ),
                  )
                  .toList(),
              onChanged: _busy
                  ? null
                  : (id) {
                      setState(() => _credential = _credentials.firstWhere((c) => c.id == id));
                      unawaited(_act(_loadModels));
                    },
            ),
            DropdownButtonFormField<String>(
              isExpanded: true,
              key: ValueKey('model-${_credential?.id}-${_models.length}'),
              initialValue: _modelId,
              decoration: InputDecoration(labelText: say('Model', 'মডেল')),
              items: _models
                  .map((m) => DropdownMenuItem(value: m.modelId, child: Text(m.displayName)))
                  .toList(),
              onChanged: _busy ? null : (id) => setState(() => _modelId = id),
            ),
            SwitchListTile(
              title: Text(say('History summary', 'ইতিহাসের সারাংশ')),
              value: _history,
              onChanged: _busy ? null : (value) => setState(() => _history = value),
            ),
            Text(
              say(
                'Authorized patient history is included. Saved draft note sections are not sent from this screen.',
                'অনুমোদিত রোগীর ইতিহাস ব্যবহৃত হবে। এই স্ক্রিন থেকে খসড়া নোটের অংশ পাঠানো হয় না।',
              ),
            ),
            if (!widget.canWrite)
              Text(
                say(
                  'Save or resolve the note before requesting or approving.',
                  'অনুরোধ বা অনুমোদনের আগে নোট সংরক্ষণ করুন বা বিরোধ সমাধান করুন।',
                ),
              ),
            FilledButton(
              onPressed:
                  _busy ||
                      !_historyLoaded ||
                      !widget.canWrite ||
                      _modelId == null ||
                      pending ||
                      _historyJobs.any(
                        (previous) => [
                          hm.AiJobStatus.queued,
                          hm.AiJobStatus.running,
                          hm.AiJobStatus.waitingRateLimit,
                        ].contains(previous.status),
                      )
                  ? null
                  : () => unawaited(_act(_request)),
              child: Text(say('Request suggestions', 'প্রস্তাব অনুরোধ করুন')),
            ),
            if (_error != null) Text(_error!, key: const Key('aiError')),
            if (widget.needsChartRefresh)
              TextButton(
                onPressed: _busy ? null : () => unawaited(_act(widget.onApproved)),
                child: Text(say('Reload chart', 'রেকর্ড আবার লোড করুন')),
              ),
            if (_jobId != null && job == null)
              TextButton(
                onPressed: _busy ? null : () => unawaited(_act(_refresh)),
                child: Text(say('Refresh review', 'পর্যালোচনা রিফ্রেশ করুন')),
              ),
            if (job != null) ...[
              Text('${job.status.name}${job.errorClass == null ? '' : ' · ${job.errorClass}'}'),
              Text(
                '${job.providerCode} · ${job.modelId} — ${job.effectiveDataUsePolicy != hm.AiJobEffectiveDataUsePolicy.noTrainingContractual ? say('Provider may train on or review submitted data.', 'প্রদানকারী পাঠানো তথ্য দিয়ে প্রশিক্ষণ বা পর্যালোচনা করতে পারে।') : say('Contractual no-training policy.', 'চুক্তি অনুযায়ী প্রশিক্ষণে তথ্য ব্যবহার করা হয় না।')}',
              ),
              if (pending)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => unawaited(
                          _act(() async {
                            await ref
                                .read(apiClientProvider)
                                .ai
                                .cancelAiJob(
                                  id: job.id,
                                  xTenantId: _tenant!,
                                  idempotencyKey: newIdempotencyKey(),
                                );
                            await _refresh();
                          }),
                        ),
                  child: Text(say('Cancel request', 'অনুরোধ বাতিল করুন')),
                ),
              TextButton(
                onPressed: _busy ? null : () => unawaited(_act(_refresh)),
                child: Text(say('Refresh review', 'পর্যালোচনা রিফ্রেশ করুন')),
              ),
            ],
            if (draft != null) ...[
              Text('${draft.status.name} · ${draft.expiresAt.toLocal()}'),
              if (draft.droppedUnsourcedCount > 0)
                Text(
                  '${say('Unsourced suggestions discarded', 'উৎসহীন প্রস্তাব বাদ দেওয়া হয়েছে')}: ${draft.droppedUnsourcedCount}',
                ),
              if (reviewable)
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => unawaited(
                          _act(() async {
                            await ref
                                .read(apiClientProvider)
                                .ai
                                .closeAiDraft(
                                  id: draft.id,
                                  xTenantId: _tenant!,
                                  idempotencyKey: newIdempotencyKey(),
                                );
                            await _refresh();
                          }),
                        ),
                  child: Text(say('Finish review', 'পর্যালোচনা শেষ করুন')),
                ),
              for (final suggestion in draft.suggestions)
                _AiSuggestionCard(
                  key: ValueKey('${suggestion.id}:${suggestion.rowVersion}'),
                  suggestion: suggestion,
                  canReview: reviewable && !_busy && _error == null,
                  canApprove: reviewable && !_busy && _error == null && widget.canWrite,
                  noteVersion: widget.noteRowVersion,
                  say: say,
                  review: (body) => _act(() async {
                    await ref
                        .read(apiClientProvider)
                        .ai
                        .reviewAiSuggestion(
                          id: suggestion.id,
                          xTenantId: _tenant!,
                          idempotencyKey: newIdempotencyKey(),
                          body: body,
                        );
                    await _refresh();
                  }),
                  approve: (body) => _act(() async {
                    await ref
                        .read(apiClientProvider)
                        .ai
                        .approveAiSuggestion(
                          id: suggestion.id,
                          xTenantId: _tenant!,
                          idempotencyKey: newIdempotencyKey(),
                          body: body,
                        );
                  }, clinical: true),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _AiSuggestionCard extends StatefulWidget {
  const _AiSuggestionCard({
    super.key,
    required this.suggestion,
    required this.canReview,
    required this.canApprove,
    required this.noteVersion,
    required this.say,
    required this.review,
    required this.approve,
  });
  final hm.AiSuggestion suggestion;
  final bool canReview, canApprove;
  final int? noteVersion;
  final String Function(String, String) say;
  final Future<void> Function(hm.ReviewAiSuggestionRequest) review;
  final Future<void> Function(hm.ApproveAiSuggestionRequest) approve;
  @override
  State<_AiSuggestionCard> createState() => _AiSuggestionCardState();
}

class _AiSuggestionCardState extends State<_AiSuggestionCard> {
  late final TextEditingController _text;
  late final Map<String, Object?> _candidate;
  late final String _original;
  bool _attested = false, _replace = false;
  @override
  void initState() {
    super.initState();
    final value = widget.suggestion.editedCandidate ?? widget.suggestion.candidate;
    _candidate = value is Map ? Map<String, Object?>.from(value) : {};
    _original = (_candidate['text'] ?? _candidate['display'] ?? '').toString();
    _text = TextEditingController(text: _original);
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _review(String decision) => widget.review(
    hm.ReviewAiSuggestionRequest.fromJson({
      'decision': decision,
      'expectedRowVersion': widget.suggestion.rowVersion,
      if (decision == 'EDIT')
        'editedCandidate': {
          ..._candidate,
          widget.suggestion.suggestionType == hm.AiSuggestionSuggestionType.diagnosis ? 'display' : 'text':
              _text.text,
        },
    }),
  );
  @override
  Widget build(BuildContext context) {
    final s = widget.suggestion, say = widget.say;
    final note = s.suggestionType == hm.AiSuggestionSuggestionType.noteSection;
    final diagnosis = s.suggestionType == hm.AiSuggestionSuggestionType.diagnosis;
    final supported =
        diagnosis ||
        (note &&
            widget.noteVersion != null &&
            ['chief_complaint', 'history', 'examination', 'assessment', 'plan'].contains(s.targetSection));
    final changed = _text.text != _original;
    final mutable =
        widget.canReview &&
        [
          hm.AiSuggestionStatus.pending,
          hm.AiSuggestionStatus.accepted,
          hm.AiSuggestionStatus.edited,
        ].contains(s.status);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '${s.suggestionType.name} · ${s.status.name}${s.targetSection == null ? '' : ' · ${s.targetSection}'}',
            ),
            if ([hm.AiSuggestionConfidence.low, hm.AiSuggestionConfidence.unknown].contains(s.confidence))
              Text(
                say(
                  'Low or unknown confidence — verify carefully.',
                  'আস্থা কম বা অজানা — সতর্কভাবে যাচাই করুন।',
                ),
              ),
            if (diagnosis)
              Text(
                '${_candidate['certainty'] ?? ''} ${_candidate['codeSystem'] ?? ''} ${_candidate['code'] ?? ''}',
              ),
            TextField(
              controller: _text,
              readOnly: !mutable || !supported,
              maxLines: 4,
              maxLength: diagnosis ? 300 : 4000,
              decoration: InputDecoration(labelText: say('Suggestion content', 'প্রস্তাবের বিষয়বস্তু')),
              onChanged: (_) => setState(() => _attested = false),
            ),
            Text(
              '${say('Sources', 'উৎস')}: ${s.sourceRefs.map((r) => '${r.sourceType} · ${r.occurredAt.toLocal()}').join('; ')}',
            ),
            if (mutable)
              Wrap(
                children: [
                  if (changed)
                    TextButton(
                      onPressed: _text.text.trim().isEmpty ? null : () => unawaited(_review('EDIT')),
                      child: Text(say('Save edit', 'সম্পাদনা সংরক্ষণ করুন')),
                    )
                  else if (s.status == hm.AiSuggestionStatus.pending)
                    TextButton(
                      onPressed: () => unawaited(_review('ACCEPT')),
                      child: Text(say('Accept for review', 'পর্যালোচনার জন্য গ্রহণ করুন')),
                    ),
                  TextButton(
                    onPressed: () => unawaited(_review('REJECT')),
                    child: Text(say('Reject', 'প্রত্যাখ্যান করুন')),
                  ),
                  TextButton(
                    onPressed: () => unawaited(_review('IGNORE')),
                    child: Text(say('Ignore', 'এড়িয়ে যান')),
                  ),
                ],
              ),
            if (widget.canReview &&
                [hm.AiSuggestionStatus.rejected, hm.AiSuggestionStatus.ignored].contains(s.status))
              TextButton(
                onPressed: () => unawaited(_review('REOPEN')),
                child: Text(say('Reopen', 'আবার খুলুন')),
              ),
            if (supported &&
                [hm.AiSuggestionStatus.accepted, hm.AiSuggestionStatus.edited].contains(s.status)) ...[
              if (note)
                SwitchListTile(
                  title: Text(
                    say('Replace section (otherwise append)', 'অংশ প্রতিস্থাপন করুন (অন্যথায় শেষে যোগ হবে)'),
                  ),
                  value: _replace,
                  onChanged: widget.canApprove
                      ? (v) => setState(() {
                          _replace = v;
                          _attested = false;
                        })
                      : null,
                ),
              CheckboxListTile(
                value: _attested,
                onChanged: widget.canApprove && !changed
                    ? (v) => setState(() => _attested = v == true)
                    : null,
                title: Text(
                  say(
                    'I reviewed the content and sources, verified clinical accuracy, and take responsibility for adding this to the chart.',
                    'আমি বিষয়বস্তু ও উৎস পর্যালোচনা করেছি, চিকিৎসাগত নির্ভুলতা যাচাই করেছি এবং রোগীর রেকর্ডে এটি যোগ করার দায়িত্ব নিচ্ছি।',
                  ),
                ),
              ),
              FilledButton(
                onPressed: !widget.canApprove || !_attested || changed
                    ? null
                    : () {
                        final body = hm.ApproveAiSuggestionRequest.fromJson({
                          'approvedTarget': note ? 'ENCOUNTER_NOTE_SECTION' : 'DIAGNOSIS',
                          'expectedRowVersion': s.rowVersion,
                          'attestationVersion': 1,
                          if (note)
                            'noteSection': {
                              'section': s.targetSection,
                              'mode': _replace ? 'REPLACE' : 'APPEND',
                              'text': _text.text,
                              'expectedNoteRowVersion': widget.noteVersion,
                            },
                          if (diagnosis)
                            'diagnosis': {
                              'display': _text.text,
                              'certainty': _candidate['certainty'],
                              if (_candidate['code'] != null && _candidate['codeSystem'] != null)
                                'code': _candidate['code'],
                              if (_candidate['code'] != null && _candidate['codeSystem'] != null)
                                'codeSystem': _candidate['codeSystem'],
                            },
                        });
                        unawaited(widget.approve(body));
                      },
                child: Text(
                  say('Approve this suggestion into the chart', 'এই প্রস্তাব রোগীর রেকর্ডে অনুমোদন করুন'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
