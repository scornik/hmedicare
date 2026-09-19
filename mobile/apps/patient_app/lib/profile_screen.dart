import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart' show Patient;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_context.dart';

/// `GET /patients/{id}` as the active context (SELF or guardian with VIEW_RECORDS). Read through the
/// session cache: offline, the last copy is shown with a staleness indicator; there are no mutations here.
final patientProfileProvider = FutureProvider.autoDispose<CachedRead<Patient>>((ref) async {
  final ctx = ref.watch(activeContextProvider);
  if (ctx == null) throw StateError('no active context');
  final api = ref.read(apiClientProvider);
  return ref.read(readCacheProvider).readThrough<Patient>(
    'patient:${ctx.tenantId}:${ctx.patientId}',
    () async {
      try {
        final r = await api.patients.getPatient(
          id: ctx.patientId,
          xTenantId: ctx.tenantId,
          xPatientContext: ctx.patientId,
        );
        return r.data;
      } on DioException catch (e) {
        throw ApiProblem.fromDio(e);
      }
    },
  );
});

String staleness(HmStrings s, CachedRead<Object?> read, DateTime now) {
  final minutes = read.age(now).inMinutes;
  final when = minutes < 1 ? s.t('updatedJustNow') : s.t('updatedMinutesAgo').replaceFirst('{n}', '$minutes');
  return read.stale ? '${s.t('showingSavedCopy')} · $when' : when;
}

class PatientProfileScreen extends ConsumerWidget {
  const PatientProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = HmStrings.of(context);
    final ctx = ref.watch(activeContextProvider);
    final profile = ref.watch(patientProfileProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(ctx?.patientDisplayName ?? s.t('profile')),
        leading: IconButton(
          key: const Key('switchProfile'),
          tooltip: s.t('switchProfile'),
          icon: const Icon(Icons.switch_account),
          onPressed: () => context.go('/contexts'),
        ),
        actions: [
          IconButton(
            key: const Key('refresh'),
            tooltip: s.t('refresh'),
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(patientProfileProvider),
          ),
        ],
      ),
      body: profile.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (e, _) => Center(
          child: Text(e is ApiProblem && e.code == 'NETWORK_UNAVAILABLE' ? s.t('offline') : s.t('error')),
        ),
        data: (read) {
          final p = read.value;
          final bn = Localizations.localeOf(context).languageCode == 'bn';
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Chip(
                key: const Key('staleness'),
                avatar: Icon(read.stale ? Icons.cloud_off : Icons.cloud_done, size: 18),
                label: Text(staleness(s, read, DateTime.now())),
              ),
              const SizedBox(height: 12),
              Text(
                bn && p.legalNameBn != null ? p.legalNameBn! : p.legalName,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              if (ctx != null && ctx.tenantName.isNotEmpty) Text(ctx.tenantName),
              const SizedBox(height: 12),
              ListTile(
                title: Text(s.t('mrn')),
                subtitle: Text(p.medicalRecordNumber, key: const Key('mrn')),
              ),
              ListTile(
                title: Text(s.t('sex')),
                subtitle: Text(p.sex?.json == null ? '—' : s.t('sex${p.sex!.json}')),
              ),
              ListTile(
                title: Text(s.t('birth')),
                subtitle: Text(p.dateOfBirth ?? (p.birthYear == null ? '—' : '${p.birthYear}')),
              ),
              ListTile(title: Text(s.t('contacts'))),
              for (final c in p.contacts)
                ListTile(
                  dense: true,
                  leading: Icon(c.isPreferred ? Icons.star : Icons.phone, size: 18),
                  title: Text(c.displayValue),
                  subtitle: Text(
                    c.verificationStatus.json == 'VERIFIED' ? s.t('verified') : s.t('unverified'),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
