import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_design/hm_design.dart';
import 'package:hm_localization/hm_localization.dart';
import 'active_tenant.dart';

class DoctorTimelineScreen extends ConsumerWidget {
  const DoctorTimelineScreen({super.key, required this.patientId});
  final String patientId;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tenant = ref.watch(activeTenantProvider), auth = ref.watch(authControllerProvider);
    final s = HmStrings.of(context);
    if (tenant == null || auth.status != AuthStatus.signedIn) return const Scaffold();
    return HmTimelineView(
      key: ValueKey('${auth.user?.id}:$tenant:$patientId'),
      title: s.t('timeline_title'),
      empty: s.t('timeline_empty'),
      failed: s.t('timeline_failed'),
      staleLabel: s.t('timeline_stale'),
      more: s.t('timeline_more'),
      refresh: s.t('timeline_refresh'),
      load: (cursor) async {
        final r = await ref
            .read(apiClientProvider)
            .timeline
            .getPatientTimeline(id: patientId, xTenantId: tenant, cursor: cursor);
        return TimelineReadPage(
          r.data.items
              .map((e) => TimelineRecord(e.id, s.timelineEntryLabel(e.eventType, e.summary), e.occurredAt))
              .toList(),
          r.data.nextCursor,
          r.data.stale,
        );
      },
    );
  }
}
