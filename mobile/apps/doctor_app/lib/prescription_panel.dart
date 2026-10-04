import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart'
    show
        ApprovePrescriptionRequest,
        EditPrescriptionRequest,
        MedicationSearchItem,
        Prescription,
        PrescriptionItemInput,
        PrescriptionRowVersionOnly;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_tenant.dart';

/// The prescription editor on the doctor's phone (Stage 7 CP10).
///
/// Same three rules as the web editor, because they are properties of prescribing rather than of a
/// screen size:
///
/// **Nothing clinical is prefilled.** A catalog pick fills the brand and the strength text and leaves
/// dose, frequency and duration empty. A pad that guesses a dose is a pad that gets one accepted
/// without being read, and a phone used standing up between patients is exactly where that happens.
///
/// **An approved prescription is read-only.** The server refuses the edit anyway; offering the fields
/// and then rejecting the save would waste the work and teach the wrong model.
///
/// **Every catalog line says it is unverified.** The whole Stage M dataset is `UNVERIFIED`, so the
/// badge rides on the row rather than hiding in a detail screen nobody opens on a phone.
final prescriptionsProvider = FutureProvider.autoDispose.family<List<Prescription>, String>((
  ref,
  encounterId,
) async {
  final tenantId = ref.watch(activeTenantProvider);
  if (tenantId == null) throw StateError('no active tenant');
  final api = ref.read(apiClientProvider);
  try {
    final r = await api.prescriptions.listEncounterPrescriptions(id: encounterId, xTenantId: tenantId);
    return r.data.items;
  } on DioException catch (e) {
    throw ApiProblem.fromDio(e);
  }
});

class PrescriptionPanel extends ConsumerStatefulWidget {
  const PrescriptionPanel({required this.encounterId, super.key});

  final String encounterId;

  @override
  ConsumerState<PrescriptionPanel> createState() => _PrescriptionPanelState();
}

class _PrescriptionPanelState extends ConsumerState<PrescriptionPanel> {
  final _search = TextEditingController();
  List<PrescriptionItemInput> _items = const [];
  List<MedicationSearchItem> _hits = const [];
  bool _attested = false;
  bool _busy = false;
  String? _loadedFrom;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  String? get _tenantId => ref.read(activeTenantProvider);

  /// Items are required to be complete before approve is offered, so the check lives in one place.
  bool get _incomplete =>
      _items.any((i) => i.dose.trim().isEmpty || i.frequency.trim().isEmpty || i.duration.trim().isEmpty);

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(prescriptionsProvider(widget.encounterId));
    } on DioException catch (e) {
      if (mounted) {
        final problem = ApiProblem.fromDio(e);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(problem.code)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openDraft() => _run(() async {
    final api = ref.read(apiClientProvider);
    await api.prescriptions.createPrescriptionDraft(
      id: widget.encounterId,
      xTenantId: _tenantId!,
      idempotencyKey: newIdempotencyKey(),
    );
  });

  Future<void> _searchMedications(String q) async {
    if (q.trim().length < 2) {
      setState(() => _hits = const []);
      return;
    }
    final api = ref.read(apiClientProvider);
    try {
      final r = await api.prescriptions.searchMedications(q: q.trim(), xTenantId: _tenantId!, limit: 8);
      if (mounted) setState(() => _hits = r.data.items);
    } on DioException {
      if (mounted) setState(() => _hits = const []);
    }
  }

  void _addFromCatalog(MedicationSearchItem hit) {
    setState(() {
      _items = [
        ..._items,
        PrescriptionItemInput(
          sequence: _items.length + 1,
          medicationId: hit.medicationId,
          medicationDatasetVersion: hit.source.datasetVersion,
          isFreeText: false,
          // The two the catalog may fill, both still editable.
          strength: hit.strengthText,
          dosageForm: hit.dosageForm,
          // Deliberately empty: the catalog has no business filling these in.
          dose: '',
          frequency: '',
          duration: '',
          substitutionAllowed: true,
        ),
      ];
      _search.clear();
      _hits = const [];
    });
  }

  void _addFreeText(String name) {
    setState(() {
      _items = [
        ..._items,
        PrescriptionItemInput(
          sequence: _items.length + 1,
          isFreeText: true,
          freeTextName: name,
          dose: '',
          frequency: '',
          duration: '',
          substitutionAllowed: true,
        ),
      ];
      _search.clear();
      _hits = const [];
    });
  }

  void _setItem(int index, PrescriptionItemInput next) {
    setState(() {
      _items = [
        for (var i = 0; i < _items.length; i++)
          if (i == index) next else _items[i],
      ];
    });
  }

  void _removeItem(int index) {
    setState(() {
      final kept = [..._items]..removeAt(index);
      _items = [for (var i = 0; i < kept.length; i++) _withSequence(kept[i], i + 1)];
    });
  }

  PrescriptionItemInput _withSequence(PrescriptionItemInput item, int sequence) => PrescriptionItemInput(
    sequence: sequence,
    medicationId: item.medicationId,
    medicationDatasetVersion: item.medicationDatasetVersion,
    catalogSnapshot: item.catalogSnapshot,
    freeTextName: item.freeTextName,
    isFreeText: item.isFreeText,
    strength: item.strength,
    dosageForm: item.dosageForm,
    route: item.route,
    dose: item.dose,
    frequency: item.frequency,
    duration: item.duration,
    quantity: item.quantity,
    timing: item.timing,
    instructions: item.instructions,
    instructionsBn: item.instructionsBn,
    substitutionAllowed: item.substitutionAllowed,
  );

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final list = ref.watch(prescriptionsProvider(widget.encounterId));

    return list.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (_, _) => const SizedBox.shrink(),
      data: (all) {
        final current = all
            .where((p) => p.clinicalStatus.json == 'DRAFT' || p.clinicalStatus.json == 'REVIEWED')
            .followedBy(all.where((p) => p.clinicalStatus.json == 'APPROVED'))
            .followedBy(all)
            .firstOrNull;

        if (current == null) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: FilledButton(
              key: const Key('rxOpen'),
              onPressed: _busy ? null : _openDraft,
              child: Text(s.t('rxOpen')),
            ),
          );
        }

        // Load the server's items once per revision, so typing is not overwritten by a refetch.
        final stamp = '${current.id}:${current.rowVersion}';
        if (_loadedFrom != stamp) {
          _loadedFrom = stamp;
          _items = current.items.map(_asInput).toList();
          _attested = false;
        }

        final editable = current.clinicalStatus.json == 'DRAFT' || current.clinicalStatus.json == 'REVIEWED';

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(s.t('rxTitle'), style: Theme.of(context).textTheme.titleMedium),
            Text('${current.revision} · ${current.clinicalStatus.json}', key: const Key('rxStatus')),
            if (!editable) Text(s.t('rxLocked'), key: const Key('rxLocked')),
            if (editable) ...[
              Text(s.t('rxNoSuggestion')),
              TextField(
                key: const Key('rxSearch'),
                controller: _search,
                decoration: InputDecoration(labelText: s.t('rxSearch')),
                onChanged: _searchMedications,
              ),
              for (final hit in _hits)
                ListTile(
                  key: Key('rxPick_${hit.medicationId}'),
                  title: Text(hit.brandName),
                  // Every catalog row carries the dataset's own review status.
                  subtitle: Text('${hit.genericDisplay} · ${s.t('rxUnverified')}'),
                  onTap: () => _addFromCatalog(hit),
                ),
              if (_hits.isEmpty && _search.text.trim().length >= 2)
                ListTile(
                  key: const Key('rxAddFreeText'),
                  title: Text(s.t('rxNoResults')),
                  subtitle: Text(s.t('rxAddFreeText')),
                  onTap: () => _addFreeText(_search.text.trim()),
                ),
            ],
            if (_items.isEmpty) Text(s.t('rxEmpty'), key: const Key('rxEmpty')),
            for (var i = 0; i < _items.length; i++) _itemCard(s, i, editable),
            if (editable) ...[
              if (_incomplete) Text(s.t('rxRequired'), key: const Key('rxRequired')),
              FilledButton(
                key: const Key('rxSave'),
                onPressed: _busy ? null : _save,
                child: Text(s.t('rxSave')),
              ),
              CheckboxListTile(
                key: const Key('rxAttest'),
                value: _attested,
                onChanged: (v) => setState(() => _attested = v ?? false),
                title: Text(s.t('rxAttestation')),
              ),
              FilledButton(
                key: const Key('rxApprove'),
                onPressed: (_busy || !_attested || _incomplete || _items.isEmpty)
                    ? null
                    : () => _approve(current),
                child: Text(s.t('rxApprove')),
              ),
            ],
            if (current.clinicalStatus.json == 'APPROVED')
              FilledButton(
                key: const Key('rxCorrection'),
                onPressed: _busy ? null : () => _correct(current),
                child: Text(s.t('rxCorrection')),
              ),
          ],
        );
      },
    );
  }

  Widget _itemCard(HmStrings s, int index, bool editable) {
    final item = _items[index];
    final name = item.isFreeText ? (item.freeTextName ?? '') : (item.strength ?? '');
    return Card(
      key: Key('rxItem_$index'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ListTile(
            title: Text(name),
            // A free-text line is marked wherever it appears, so it is never mistaken for a catalog one.
            subtitle: Text(item.isFreeText ? s.t('rxFreeText') : s.t('rxUnverified')),
            trailing: editable
                ? IconButton(
                    key: Key('rxRemove_$index'),
                    icon: const Icon(Icons.delete_outline),
                    tooltip: s.t('rxRemove'),
                    onPressed: () => _removeItem(index),
                  )
                : null,
          ),
          TextField(
            key: Key('rxDose_$index'),
            enabled: editable,
            controller: TextEditingController(text: item.dose),
            decoration: InputDecoration(labelText: s.t('rxDose')),
            onChanged: (v) => _setItem(index, _copyWith(item, dose: v)),
          ),
          TextField(
            key: Key('rxFrequency_$index'),
            enabled: editable,
            controller: TextEditingController(text: item.frequency),
            decoration: InputDecoration(labelText: s.t('rxFrequency')),
            onChanged: (v) => _setItem(index, _copyWith(item, frequency: v)),
          ),
          TextField(
            key: Key('rxDuration_$index'),
            enabled: editable,
            controller: TextEditingController(text: item.duration),
            decoration: InputDecoration(labelText: s.t('rxDuration')),
            onChanged: (v) => _setItem(index, _copyWith(item, duration: v)),
          ),
        ],
      ),
    );
  }

  PrescriptionItemInput _copyWith(
    PrescriptionItemInput item, {
    String? dose,
    String? frequency,
    String? duration,
  }) => PrescriptionItemInput(
    sequence: item.sequence,
    medicationId: item.medicationId,
    medicationDatasetVersion: item.medicationDatasetVersion,
    catalogSnapshot: item.catalogSnapshot,
    freeTextName: item.freeTextName,
    isFreeText: item.isFreeText,
    strength: item.strength,
    dosageForm: item.dosageForm,
    route: item.route,
    dose: dose ?? item.dose,
    frequency: frequency ?? item.frequency,
    duration: duration ?? item.duration,
    quantity: item.quantity,
    timing: item.timing,
    instructions: item.instructions,
    instructionsBn: item.instructionsBn,
    substitutionAllowed: item.substitutionAllowed,
  );

  PrescriptionItemInput _asInput(dynamic row) => PrescriptionItemInput(
    sequence: row.sequence as int,
    medicationId: row.medicationId as String?,
    medicationDatasetVersion: row.medicationDatasetVersion as String?,
    freeTextName: row.freeTextName as String?,
    isFreeText: row.isFreeText as bool,
    strength: row.strength as String?,
    dosageForm: row.dosageForm as String?,
    route: row.route as String?,
    dose: row.dose as String,
    frequency: row.frequency as String,
    duration: row.duration as String,
    quantity: row.quantity as String?,
    timing: row.timing as String?,
    instructions: row.instructions as String?,
    instructionsBn: row.instructionsBn as String?,
    substitutionAllowed: row.substitutionAllowed as bool,
  );

  Future<void> _save() => _run(() async {
    final api = ref.read(apiClientProvider);
    final current = ref.read(prescriptionsProvider(widget.encounterId)).value!.first;
    await api.prescriptions.editPrescriptionDraft(
      id: current.id,
      xTenantId: _tenantId!,
      body: EditPrescriptionRequest(expectedRowVersion: current.rowVersion, items: _items),
    );
  });

  Future<void> _approve(Prescription current) => _run(() async {
    final api = ref.read(apiClientProvider);
    await api.prescriptions.approvePrescription(
      id: current.id,
      xTenantId: _tenantId!,
      idempotencyKey: newIdempotencyKey(),
      body: ApprovePrescriptionRequest(expectedRowVersion: current.rowVersion, attestationVersion: 1),
    );
  });

  Future<void> _correct(Prescription current) => _run(() async {
    final api = ref.read(apiClientProvider);
    await api.prescriptions.createPrescriptionCorrection(
      id: current.id,
      xTenantId: _tenantId!,
      idempotencyKey: newIdempotencyKey(),
    );
  });
}

/// Unused today, kept so the review action has a home when the nurse flow reaches the phone.
typedef ReviewRequest = PrescriptionRowVersionOnly;
