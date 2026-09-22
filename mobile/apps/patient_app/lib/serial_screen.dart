import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart' show PatientSerialView, RowVersionOnlyRequest;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_context.dart';
import 'profile_screen.dart' show staleness;

/// How often the patient's serial re-reads while the screen is open. QUEUE §4.2 puts the patient view on a
/// slower cadence than the staff board: a phone on mobile data should not poll every five seconds.
const patientPollInterval = Duration(seconds: 20);

/// `GET /me/serials` as the active context. Read through the session cache, so a lost connection shows the
/// last copy with a staleness indicator rather than an empty screen — a patient in a waiting room with no
/// signal still needs to see the number they were given.
final mySerialsProvider = FutureProvider.autoDispose<CachedRead<List<PatientSerialView>>>((ref) async {
  final ctx = ref.watch(activeContextProvider);
  if (ctx == null) throw StateError('no active context');
  final api = ref.read(apiClientProvider);
  return ref.read(readCacheProvider).readThrough<List<PatientSerialView>>(
    'serials:${ctx.tenantId}:${ctx.patientId}',
    () async {
      try {
        final r = await api.serials.listMySerials(
          xTenantId: ctx.tenantId,
          xPatientContext: ctx.patientId,
          limit: 10,
        );
        return r.data.items;
      } on DioException catch (e) {
        throw ApiProblem.fromDio(e);
      }
    },
  );
});

/// The patient's own serial and where the queue has reached (QUEUE §4.2). Never another patient's identity:
/// the server sends a count of people ahead, not a list, and every figure is labelled an estimate.
class PatientSerialScreen extends ConsumerStatefulWidget {
  const PatientSerialScreen({super.key});

  @override
  ConsumerState<PatientSerialScreen> createState() => _PatientSerialScreenState();
}

class _PatientSerialScreenState extends ConsumerState<PatientSerialScreen> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(patientPollInterval, (_) {
      if (mounted) ref.invalidate(mySerialsProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    final serials = ref.watch(mySerialsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('mySerial')),
        leading: IconButton(
          key: const Key('backToProfile'),
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/profile'),
        ),
        actions: [
          IconButton(
            key: const Key('refresh'),
            tooltip: s.t('refresh'),
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(mySerialsProvider),
          ),
        ],
      ),
      body: serials.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (e, _) => Center(
          child: Text(e is ApiProblem && e.code == 'NETWORK_UNAVAILABLE' ? s.t('offline') : s.t('error')),
        ),
        data: (read) {
          final items = read.value;
          if (items.isEmpty) return Center(child: Text(s.t('noSerials'), key: const Key('noSerials')));
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Chip(
                key: const Key('staleness'),
                avatar: Icon(read.stale ? Icons.cloud_off : Icons.cloud_done, size: 18),
                label: Text(staleness(s, read, DateTime.now())),
              ),
              const SizedBox(height: 12),
              for (final v in items) _SerialCard(view: v),
            ],
          );
        },
      ),
    );
  }
}

class _SerialCard extends ConsumerWidget {
  const _SerialCard({required this.view});

  final PatientSerialView view;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = HmStrings.of(context);
    final locale = Localizations.localeOf(context).languageCode;
    String n(int v) => locale == 'bn' ? toBanglaDigits('$v') : '$v';
    final remote = view.careMode.json == 'REMOTE' || view.careMode.json == 'HYBRID';
    return Card(
      key: Key('serial-${view.serialId}'),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  '${s.t('serialNumber')} ${n(view.serialNumber)}',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const Spacer(),
                Chip(label: Text(s.t('s${view.status.json}')), key: const Key('serialStatus')),
              ],
            ),
            Text(view.localDate),
            const SizedBox(height: 8),
            // Before arrival the server sends an estimated position; after it, a live count of people
            // ahead. They are different things and the screen never shows both as one number.
            if (view.peopleAhead != null)
              ListTile(
                dense: true,
                title: Text(s.t('peopleAhead')),
                subtitle: Text(n(view.peopleAhead!), key: const Key('peopleAhead')),
              )
            else if (view.estimatedPosition != null)
              ListTile(
                dense: true,
                title: Text(s.t('estimatedPosition')),
                subtitle: Text(n(view.estimatedPosition!), key: const Key('estimatedPosition')),
              ),
            if (view.estimatedWaitMinutes != null)
              ListTile(
                dense: true,
                title: Text(s.t('estimatedWait')),
                subtitle: Text(n(view.estimatedWaitMinutes!)),
              ),
            if (view.expectedDelayMinutes != null)
              ListTile(
                dense: true,
                title: Text(s.t('expectedDelay')),
                subtitle: Text(n(view.expectedDelayMinutes!)),
              ),
            Text(s.t('estimateOnly'), style: Theme.of(context).textTheme.bodySmall),
            if (remote && view.status.json == 'CHECKED_IN')
              Align(
                alignment: Alignment.centerRight,
                child: _ReadyButton(serialId: view.serialId, rowVersion: view.rowVersion),
              ),
          ],
        ),
      ),
    );
  }
}

/// MarkRemoteReady: a remote patient signals they are at the device. The view carries the row's version, so
/// the command goes straight out; a version the server has moved past is refused rather than applied.
class _ReadyButton extends ConsumerStatefulWidget {
  const _ReadyButton({required this.serialId, required this.rowVersion});

  final String serialId;
  final int rowVersion;

  @override
  ConsumerState<_ReadyButton> createState() => _ReadyButtonState();
}

class _ReadyButtonState extends ConsumerState<_ReadyButton> {
  bool _busy = false;

  Future<void> _send() async {
    final ctx = ref.read(activeContextProvider);
    if (ctx == null || _busy) return;
    setState(() => _busy = true);
    final api = ref.read(apiClientProvider);
    try {
      await api.serials.markRemoteReady(
        id: widget.serialId,
        xTenantId: ctx.tenantId,
        xPatientContext: ctx.patientId,
        idempotencyKey: newIdempotencyKey(),
        body: RowVersionOnlyRequest(expectedRowVersion: widget.rowVersion),
      );
      ref.invalidate(mySerialsProvider);
    } on DioException {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(HmStrings.of(context).t('error'))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      key: const Key('imReady'),
      onPressed: _busy ? null : _send,
      child: Text(HmStrings.of(context).t('imReady')),
    );
  }
}
