import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart'
    show
        AddDiagnosisRequest,
        AddDiagnosisRequestCertainty,
        AmendNoteRequest,
        ApiV1EncountersIdCompleteRequestBody,
        Diagnosis,
        DiagnosisClinicalStatus,
        EncounterNoteDraft,
        EncounterNoteDraftStatus,
        SaveNoteDraftRequest,
        Sections,
        SignNoteRequest,
        VoidDiagnosisRequest;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_tenant.dart';

/// How long after the last keystroke the draft is sent. Longer than the web's, because a phone keyboard
/// on a clinic's connection is slower and a request per letter would be worse than useless.
const autosaveDebounce = Duration(milliseconds: 1500);

/// `GET /encounters/{id}/note`. Not cached for offline reading: a consultation note is not something to
/// leave sitting in a phone's storage, and mutations here are online-only as in Stage 5.
final noteDraftProvider = FutureProvider.autoDispose.family<EncounterNoteDraft, String>((
  ref,
  encounterId,
) async {
  final tenantId = ref.watch(activeTenantProvider);
  if (tenantId == null) throw StateError('no active tenant');
  final api = ref.read(apiClientProvider);
  try {
    final r = await api.encounters.getEncounterNote(id: encounterId, xTenantId: tenantId);
    return r.data;
  } on DioException catch (e) {
    throw ApiProblem.fromDio(e);
  }
});

final diagnosesProvider = FutureProvider.autoDispose.family<List<Diagnosis>, String>((
  ref,
  encounterId,
) async {
  final tenantId = ref.watch(activeTenantProvider);
  if (tenantId == null) throw StateError('no active tenant');
  final api = ref.read(apiClientProvider);
  try {
    final r = await api.encounters.listEncounterDiagnoses(id: encounterId, xTenantId: tenantId);
    return r.data;
  } on DioException catch (e) {
    throw ApiProblem.fromDio(e);
  }
});

enum _SaveState { ready, unsaved, saving, saved, conflict, failed }

/// The doctor's consultation screen: write the note, record diagnoses, sign, complete.
///
/// Simplified against the web workspace on purpose. A phone in a chamber is used standing up between
/// patients, so the sections are collapsed into one scroll and the panels for later stages are left off
/// entirely rather than shown empty — there is no room to spend on something that does nothing.
///
/// Two rules carry over exactly. Unsent text lives in memory with a visible unsaved marker and is never
/// written to device storage, and a stale save stops and asks rather than overwriting: whoever wrote the
/// other version is also a clinician.
class DoctorEncounterScreen extends ConsumerStatefulWidget {
  const DoctorEncounterScreen({required this.encounterId, super.key});

  final String encounterId;

  @override
  ConsumerState<DoctorEncounterScreen> createState() => _DoctorEncounterScreenState();
}

class _DoctorEncounterScreenState extends ConsumerState<DoctorEncounterScreen> {
  final _controllers = <String, TextEditingController>{
    'chiefComplaint': TextEditingController(),
    'history': TextEditingController(),
    'examination': TextEditingController(),
    'assessment': TextEditingController(),
    'plan': TextEditingController(),
  };
  final _diagnosis = TextEditingController();
  Timer? _debounce;
  int? _rowVersion;
  int? _lastSignedRevision;
  bool _loaded = false;
  bool _locked = false;
  _SaveState _state = _SaveState.ready;
  EncounterNoteDraft? _theirs;

  @override
  void dispose() {
    _debounce?.cancel();
    for (final c in _controllers.values) {
      c.dispose();
    }
    _diagnosis.dispose();
    super.dispose();
  }

  void _adopt(EncounterNoteDraft draft) {
    _controllers['chiefComplaint']!.text = draft.chiefComplaint ?? '';
    _controllers['history']!.text = draft.history ?? '';
    _controllers['examination']!.text = draft.examination ?? '';
    _controllers['assessment']!.text = draft.assessment ?? '';
    _controllers['plan']!.text = draft.plan ?? '';
    _rowVersion = draft.rowVersion;
    _lastSignedRevision = draft.lastSignedRevision;
    _locked = draft.status == EncounterNoteDraftStatus.signedLocked;
  }

  Sections _sections() => Sections(
    chiefComplaint: _controllers['chiefComplaint']!.text,
    history: _controllers['history']!.text,
    examination: _controllers['examination']!.text,
    assessment: _controllers['assessment']!.text,
    plan: _controllers['plan']!.text,
  );

  void _onChanged() {
    if (_state == _SaveState.conflict) return; // the doctor has to choose first
    _debounce?.cancel();
    setState(() => _state = _SaveState.unsaved);
    _debounce = Timer(autosaveDebounce, _save);
  }

  Future<void> _save() async {
    final tenantId = ref.read(activeTenantProvider);
    final version = _rowVersion;
    if (tenantId == null || version == null || _locked) return;
    _debounce?.cancel();
    setState(() => _state = _SaveState.saving);
    final api = ref.read(apiClientProvider);
    try {
      final r = await api.encounters.saveEncounterNoteDraft(
        id: widget.encounterId,
        xTenantId: tenantId,
        body: SaveNoteDraftRequest(expectedRowVersion: version, sections: _sections()),
      );
      if (!mounted) return;
      setState(() {
        _rowVersion = r.data.rowVersion;
        _state = _SaveState.saved;
      });
    } on DioException catch (e) {
      final problem = ApiProblem.fromDio(e);
      if (!mounted) return;
      if (problem.code == 'STALE_VERSION') {
        // Fetch what is actually stored so both versions can be shown. Never retried with the server's
        // version: that would overwrite whatever the other window wrote.
        try {
          final current = await api.encounters.getEncounterNote(id: widget.encounterId, xTenantId: tenantId);
          if (!mounted) return;
          setState(() {
            _theirs = current.data;
            _state = _SaveState.conflict;
          });
        } catch (_) {
          if (mounted) setState(() => _state = _SaveState.failed);
        }
        return;
      }
      setState(() => _state = _SaveState.failed);
    }
  }

  Future<void> _sign({String? reason}) async {
    final tenantId = ref.read(activeTenantProvider);
    final version = _rowVersion;
    if (tenantId == null || version == null) return;
    await _save();
    final current = _rowVersion;
    if (current == null || !mounted) return;
    final api = ref.read(apiClientProvider);
    final key = newIdempotencyKey();
    try {
      if (reason == null) {
        await api.encounters.signEncounterNote(
          id: widget.encounterId,
          xTenantId: tenantId,
          idempotencyKey: key,
          body: SignNoteRequest(expectedRowVersion: current),
        );
      } else {
        await api.encounters.amendEncounterNote(
          id: widget.encounterId,
          xTenantId: tenantId,
          idempotencyKey: key,
          body: AmendNoteRequest(expectedRowVersion: current, correctionReason: reason),
        );
      }
      if (!mounted) return;
      ref.invalidate(noteDraftProvider(widget.encounterId));
      setState(() => _loaded = false);
    } on DioException catch (e) {
      if (!mounted) return;
      _toast(ApiProblem.fromDio(e).code);
    }
  }

  Future<void> _complete() async {
    final tenantId = ref.read(activeTenantProvider);
    if (tenantId == null) return;
    final api = ref.read(apiClientProvider);
    try {
      final encounter = await api.encounters.getEncounter(id: widget.encounterId, xTenantId: tenantId);
      await api.encounters.completeEncounter(
        id: widget.encounterId,
        xTenantId: tenantId,
        idempotencyKey: newIdempotencyKey(),
        body: ApiV1EncountersIdCompleteRequestBody(expectedRowVersion: encounter.data.rowVersion),
      );
      if (!mounted) return;
      context.pop();
    } on DioException catch (e) {
      if (!mounted) return;
      _toast(ApiProblem.fromDio(e).code);
    }
  }

  Future<void> _addDiagnosis() async {
    final tenantId = ref.read(activeTenantProvider);
    final text = _diagnosis.text.trim();
    if (tenantId == null || text.isEmpty) return;
    final api = ref.read(apiClientProvider);
    try {
      await api.encounters.addEncounterDiagnosis(
        id: widget.encounterId,
        xTenantId: tenantId,
        idempotencyKey: newIdempotencyKey(),
        body: AddDiagnosisRequest(display: text, certainty: AddDiagnosisRequestCertainty.provisional),
      );
      if (!mounted) return;
      _diagnosis.clear();
      ref.invalidate(diagnosesProvider(widget.encounterId));
    } on DioException catch (e) {
      if (!mounted) return;
      _toast(ApiProblem.fromDio(e).code);
    }
  }

  Future<void> _void(Diagnosis d, String reason) async {
    final tenantId = ref.read(activeTenantProvider);
    if (tenantId == null) return;
    final api = ref.read(apiClientProvider);
    try {
      await api.encounters.voidDiagnosis(
        id: d.id,
        xTenantId: tenantId,
        idempotencyKey: newIdempotencyKey(),
        body: VoidDiagnosisRequest(expectedRowVersion: d.rowVersion, reason: reason),
      );
      if (!mounted) return;
      ref.invalidate(diagnosesProvider(widget.encounterId));
    } on DioException catch (e) {
      if (!mounted) return;
      _toast(ApiProblem.fromDio(e).code);
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final draft = ref.watch(noteDraftProvider(widget.encounterId));
    final diagnoses = ref.watch(diagnosesProvider(widget.encounterId));

    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('consultation')),
        actions: [_SaveBadge(state: _state, strings: s)],
      ),
      body: draft.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: Text(s.t('loadFailed'), key: const Key('noteError'))),
        data: (d) {
          if (!_loaded) {
            _adopt(d);
            _loaded = true;
          }
          final signed = (_lastSignedRevision ?? 0) > 0;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_state == _SaveState.conflict && _theirs != null)
                _ConflictCard(
                  strings: s,
                  theirs: _theirs!,
                  onKeepMine: () {
                    setState(() {
                      _rowVersion = _theirs!.rowVersion;
                      _state = _SaveState.saving;
                    });
                    unawaited(_save());
                  },
                  onTakeTheirs: () {
                    setState(() {
                      _adopt(_theirs!);
                      _theirs = null;
                      _state = _SaveState.ready;
                    });
                  },
                ),
              for (final section in _controllers.keys)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: TextField(
                    key: Key('note_$section'),
                    controller: _controllers[section],
                    enabled: !_locked,
                    maxLines: section == 'chiefComplaint' ? 2 : 4,
                    decoration: InputDecoration(labelText: s.t(section), border: const OutlineInputBorder()),
                    onChanged: (_) => _onChanged(),
                    onEditingComplete: _save,
                  ),
                ),
              Wrap(
                spacing: 8,
                children: [
                  if (!signed)
                    FilledButton(
                      key: const Key('signNote'),
                      onPressed: _locked || _state == _SaveState.conflict ? null : () => _sign(),
                      child: Text(s.t('signNote')),
                    )
                  else
                    OutlinedButton(
                      key: const Key('amendNote'),
                      onPressed: _locked || _state == _SaveState.conflict
                          ? null
                          : () => _askReason(s, s.t('amendReason'), (r) => _sign(reason: r)),
                      child: Text(s.t('amendNote')),
                    ),
                  FilledButton.tonal(
                    key: const Key('completeEncounter'),
                    onPressed: _complete,
                    child: Text(s.t('completeConsultation')),
                  ),
                ],
              ),
              const Divider(height: 32),
              Text(s.t('diagnoses'), style: Theme.of(context).textTheme.titleMedium),
              diagnoses.when(
                loading: () => const LinearProgressIndicator(),
                error: (_, _) => Text(s.t('loadFailed')),
                data: (list) => Column(
                  children: [
                    for (final d in list)
                      ListTile(
                        key: Key('dx_${d.id}'),
                        title: Text(
                          d.display,
                          style: d.clinicalStatus == DiagnosisClinicalStatus.enteredInError
                              ? const TextStyle(decoration: TextDecoration.lineThrough)
                              : null,
                        ),
                        subtitle: d.voidReason == null ? null : Text(d.voidReason!),
                        trailing: d.clinicalStatus == DiagnosisClinicalStatus.enteredInError || _locked
                            ? null
                            : IconButton(
                                key: Key('void_${d.id}'),
                                icon: const Icon(Icons.block),
                                tooltip: s.t('voidDiagnosis'),
                                onPressed: () => _askReason(s, s.t('voidReason'), (r) => _void(d, r)),
                              ),
                      ),
                  ],
                ),
              ),
              if (!_locked)
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        key: const Key('diagnosisInput'),
                        controller: _diagnosis,
                        decoration: InputDecoration(labelText: s.t('addDiagnosis')),
                      ),
                    ),
                    IconButton(
                      key: const Key('addDiagnosis'),
                      icon: const Icon(Icons.add),
                      onPressed: _addDiagnosis,
                    ),
                  ],
                ),
            ],
          );
        },
      ),
    );
  }

  /// Both a correction and a void need a reason, and neither is accepted without one.
  Future<void> _askReason(HmStrings s, String label, Future<void> Function(String) run) async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        content: TextField(
          key: const Key('reasonInput'),
          controller: controller,
          decoration: InputDecoration(labelText: label),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(s.t('cancel'))),
          FilledButton(
            key: const Key('reasonConfirm'),
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: Text(s.t('confirm')),
          ),
        ],
      ),
    );
    controller.dispose();
    if (reason != null && reason.length >= 3) await run(reason);
  }
}

class _SaveBadge extends StatelessWidget {
  const _SaveBadge({required this.state, required this.strings});

  final _SaveState state;
  final HmStrings strings;

  @override
  Widget build(BuildContext context) {
    final key = switch (state) {
      _SaveState.saving => 'saving',
      _SaveState.saved => 'saved',
      _SaveState.unsaved => 'unsaved',
      _SaveState.conflict => 'noteConflict',
      _SaveState.failed => 'saveFailed',
      _SaveState.ready => 'ready',
    };
    final alarming =
        state == _SaveState.unsaved || state == _SaveState.conflict || state == _SaveState.failed;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Center(
        child: Text(
          strings.t(key),
          key: const Key('saveState'),
          style: TextStyle(
            fontWeight: alarming ? FontWeight.bold : FontWeight.normal,
            color: alarming ? Theme.of(context).colorScheme.error : null,
          ),
        ),
      ),
    );
  }
}

class _ConflictCard extends StatelessWidget {
  const _ConflictCard({
    required this.strings,
    required this.theirs,
    required this.onKeepMine,
    required this.onTakeTheirs,
  });

  final HmStrings strings;
  final EncounterNoteDraft theirs;
  final VoidCallback onKeepMine;
  final VoidCallback onTakeTheirs;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('conflictCard'),
      color: Theme.of(context).colorScheme.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(strings.t('noteConflictExplain')),
            const SizedBox(height: 8),
            Text(theirs.plan ?? theirs.assessment ?? '', key: const Key('conflictTheirs')),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton(
                  key: const Key('keepMine'),
                  onPressed: onKeepMine,
                  child: Text(strings.t('keepMine')),
                ),
                OutlinedButton(
                  key: const Key('takeTheirs'),
                  onPressed: onTakeTheirs,
                  child: Text(strings.t('takeTheirs')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
