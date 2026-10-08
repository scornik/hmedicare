import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_design/hm_design.dart';
import 'package:hm_localization/hm_localization.dart';
import 'active_context.dart';

class PatientTimelineScreen extends ConsumerWidget {
  const PatientTimelineScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ctx = ref.watch(activeContextProvider), auth = ref.watch(authControllerProvider);
    final s = HmStrings.of(context);
    if (ctx == null || auth.status != AuthStatus.signedIn) return const Scaffold();
    return HmTimelineView(
      key: ValueKey('${auth.user?.id}:${ctx.tenantId}:${ctx.patientId}:${ctx.relationship}'),
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
            .getPatientTimeline(
              id: ctx.patientId,
              xTenantId: ctx.tenantId,
              xPatientContext: ctx.patientId,
              cursor: cursor,
            );
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
