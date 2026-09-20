import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart' show ChamberDay;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_core/hm_core.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_tenant.dart';

/// Today in clinic local time. Chamber days are keyed by the clinic's local date, never by UTC, so a
/// consultation that runs past midnight UTC still belongs to the evening it started (SCHED §2).
String todayLocal() {
  final now = DateTime.now().toUtc().add(const Duration(hours: 6)); // Asia/Dhaka, UTC+6 with no DST
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

/// `GET /chamber-days?from=&to=` for today, in the doctor's active tenant.
final todaysDaysProvider = FutureProvider.autoDispose<CachedRead<List<ChamberDay>>>((ref) async {
  final tenantId = ref.watch(activeTenantProvider);
  if (tenantId == null) throw StateError('no active tenant');
  final api = ref.read(apiClientProvider);
  final day = todayLocal();
  return ref.read(readCacheProvider).readThrough<List<ChamberDay>>('days:$tenantId:$day', () async {
    try {
      final r = await api.chamberDays.listChamberDays(from: day, to: day, xTenantId: tenantId);
      return r.data;
    } on DioException catch (e) {
      throw ApiProblem.fromDio(e);
    }
  });
});

/// Today's chamber days for the doctor to pick from before opening a queue.
class DoctorDaysScreen extends ConsumerWidget {
  const DoctorDaysScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = HmStrings.of(context);
    final days = ref.watch(todaysDaysProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('todaysQueue')),
        leading: IconButton(
          key: const Key('backToHome'),
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
      ),
      body: days.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (e, _) => Center(
          child: Text(e is ApiProblem && e.code == 'NETWORK_UNAVAILABLE' ? s.t('offline') : s.t('error')),
        ),
        data: (read) {
          final items = read.value;
          if (items.isEmpty) return Center(child: Text(s.t('noQueue'), key: const Key('noDays')));
          return ListView(
            children: [
              for (final d in items)
                ListTile(
                  key: Key('day-${d.id}'),
                  title: Text('${d.localStartTime}–${d.localEndTime}'),
                  subtitle: Text(s.t('d${d.status.json}')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => context.go('/queue/${d.id}'),
                ),
            ],
          );
        },
      ),
    );
  }
}
