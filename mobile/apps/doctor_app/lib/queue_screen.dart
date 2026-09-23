import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart'
    show
        ApiV1EncountersIdCompleteRequestBody,
        CallSerialRequest,
        HmApiClient,
        QueueEntry,
        QueueSnapshot,
        StartEncounterRequest;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_tenant.dart';

/// The doctor's board re-reads on the same five-second cadence as the web board (QUEUE §3.5): the doctor
/// acts on it directly, so it must not lag behind the receptionist's screen.
const doctorPollInterval = Duration(seconds: 5);

/// Bangla digits for display only; the API always sends and receives Latin digits.
String _digits(String v, String locale) => locale == 'bn' ? toBanglaDigits(v) : v;

/// `GET /chamber-days/{id}/queue`. Read through the session cache so a dropped connection in the chamber
/// shows the last board with a staleness indicator rather than an empty screen.
final queueSnapshotProvider = FutureProvider.autoDispose.family<CachedRead<QueueSnapshot>, String>((
  ref,
  chamberDayId,
) async {
  final tenantId = ref.watch(activeTenantProvider);
  if (tenantId == null) throw StateError('no active tenant');
  final api = ref.read(apiClientProvider);
  return ref.read(readCacheProvider).readThrough<QueueSnapshot>('queue:$tenantId:$chamberDayId', () async {
    try {
      final r = await api.queue.getQueue(id: chamberDayId, xTenantId: tenantId);
      return r.data;
    } on DioException catch (e) {
      throw ApiProblem.fromDio(e);
    }
  });
});

/// The doctor's live queue for one chamber day: call the next patient, start and complete the consultation
/// (ADR-021 interim transitions, retired in Stage 6). Every command carries the row's `rowVersion`, so a
/// board that has moved on is refused by the server rather than applied to the wrong patient.
class DoctorQueueScreen extends ConsumerStatefulWidget {
  const DoctorQueueScreen({required this.chamberDayId, super.key});

  final String chamberDayId;

  @override
  ConsumerState<DoctorQueueScreen> createState() => _DoctorQueueScreenState();
}

class _DoctorQueueScreenState extends ConsumerState<DoctorQueueScreen> {
  Timer? _poll;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(doctorPollInterval, (_) {
      if (mounted && !_busy) ref.invalidate(queueSnapshotProvider(widget.chamberDayId));
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  /// Runs one transition and refreshes. Polling pauses while a command is in flight so the row the doctor
  /// is acting on does not shift under the tap.
  /// Completing needs the encounter's own row version, so the board reads it first. The consultation
  /// workspace holds the encounter open and will not need the extra hop.
  Future<void> _completeEncounter(HmApiClient api, String encounterId, String tenantId, String key) async {
    final current = await api.encounters.getEncounter(id: encounterId, xTenantId: tenantId);
    await api.encounters.completeEncounter(
      id: encounterId,
      xTenantId: tenantId,
      idempotencyKey: key,
      body: ApiV1EncountersIdCompleteRequestBody(expectedRowVersion: current.data.rowVersion),
    );
  }

  Future<void> _command(Future<void> Function(String tenantId, String key) send) async {
    final tenantId = ref.read(activeTenantProvider);
    if (tenantId == null || _busy) return;
    setState(() => _busy = true);
    try {
      await send(tenantId, newIdempotencyKey());
      ref.invalidate(queueSnapshotProvider(widget.chamberDayId));
    } on DioException catch (e) {
      if (mounted) {
        final problem = ApiProblem.fromDio(e);
        final s = HmStrings.of(context);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              problem.code == 'STALE_VERSION' || problem.code == 'QUEUE_STATE_CONFLICT'
                  ? s.t('staleReload')
                  : s.t('error'),
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final snapshot = ref.watch(queueSnapshotProvider(widget.chamberDayId));
    final api = ref.read(apiClientProvider);
    final locale = Localizations.localeOf(context).languageCode;
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('todaysQueue')),
        leading: IconButton(
          key: const Key('backToHome'),
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        actions: [
          IconButton(
            key: const Key('refresh'),
            tooltip: s.t('refresh'),
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(queueSnapshotProvider(widget.chamberDayId)),
          ),
        ],
      ),
      body: snapshot.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (e, _) => Center(
          child: Text(e is ApiProblem && e.code == 'NETWORK_UNAVAILABLE' ? s.t('offline') : s.t('error')),
        ),
        data: (read) {
          final board = read.value;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Chip(
                      key: const Key('staleness'),
                      avatar: Icon(read.stale ? Icons.cloud_off : Icons.cloud_done, size: 18),
                      label: Text(_staleness(s, read)),
                    ),
                    const Spacer(),
                    Text(
                      '${s.t('waitingCount')}: ${_digits('${board.counts.waiting}', locale)}',
                      key: const Key('waitingCount'),
                    ),
                  ],
                ),
              ),
              if (board.entries.isEmpty)
                Expanded(
                  child: Center(child: Text(s.t('noQueue'), key: const Key('noQueue'))),
                )
              else
                Expanded(
                  child: ListView(
                    children: [
                      for (final e in board.entries)
                        _Row(
                          entry: e,
                          busy: _busy,
                          locale: locale,
                          onCall: () => _command(
                            (t, k) => api.serials.callSerial(
                              id: e.serialId,
                              xTenantId: t,
                              idempotencyKey: k,
                              body: CallSerialRequest(expectedRowVersion: e.rowVersion),
                            ),
                          ),
                          // Consultations are encounters now: the ADR-021 serial transitions were
                          // retired in Stage 6 and answer 410.
                          onStart: () => _command(
                            (t, k) => api.encounters.startEncounter(
                              id: e.serialId,
                              xTenantId: t,
                              idempotencyKey: k,
                              body: StartEncounterRequest(expectedRowVersion: e.rowVersion),
                            ),
                          ),
                          onComplete: e.encounterId == null
                              ? null
                              : () => _command((t, k) => _completeEncounter(api, e.encounterId!, t, k)),
                        ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }

  String _staleness(HmStrings s, CachedRead<Object?> read) {
    final minutes = read.age(DateTime.now()).inMinutes;
    final when = minutes < 1
        ? s.t('updatedJustNow')
        : s.t('updatedMinutesAgo').replaceFirst('{n}', '$minutes');
    return read.stale ? '${s.t('showingSavedCopy')} · $when' : when;
  }
}

class _Row extends StatelessWidget {
  const _Row({
    required this.entry,
    required this.busy,
    required this.locale,
    required this.onCall,
    required this.onStart,
    required this.onComplete,
  });

  final QueueEntry entry;
  final bool busy;
  final String locale;
  final VoidCallback onCall;
  final VoidCallback onStart;
  final VoidCallback? onComplete;

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final status = entry.status.json ?? '';
    return ListTile(
      key: Key('queue-${entry.serialNumber}'),
      leading: CircleAvatar(child: Text(_digits('${entry.serialNumber}', locale))),
      title: Text(entry.patientDisplayName),
      subtitle: Text('${entry.medicalRecordNumber} · ${s.t('s$status')}'),
      trailing: switch (status) {
        'WAITING' => FilledButton(
          key: const Key('callNext'),
          onPressed: busy ? null : onCall,
          child: Text(s.t('callNext')),
        ),
        'CALLED' => FilledButton(
          key: const Key('startConsultation'),
          onPressed: busy ? null : onStart,
          child: Text(s.t('startConsultation')),
        ),
        'IN_CONSULTATION' when onComplete != null => FilledButton(
          key: const Key('completeConsultation'),
          onPressed: busy ? null : onComplete,
          child: Text(s.t('completeConsultation')),
        ),
        _ => null,
      },
    );
  }
}
