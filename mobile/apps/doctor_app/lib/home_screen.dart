import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' show MembershipSummary;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_localization/hm_localization.dart';

/// Memberships from `GET /me` (tenant picker shell for Stage 5 screens).
final membershipsProvider = FutureProvider.autoDispose<List<MembershipSummary>>((ref) async {
  final me = await ref.read(apiClientProvider).me.getMe();
  return me.data.memberships;
});

class DoctorHomeScreen extends ConsumerWidget {
  const DoctorHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = HmStrings.of(context);
    final user = ref.watch(authControllerProvider).user;
    final memberships = ref.watch(membershipsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(user?.displayName ?? s.t('home')),
        actions: [
          IconButton(
            key: const Key('logout'),
            tooltip: s.t('logout'),
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: memberships.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (_, _) => Center(child: Text(s.t('error'))),
        data: (list) => list.isEmpty
            ? Center(child: Text(s.t('noOrganizations')))
            : ListView(
                children: [
                  ListTile(title: Text(s.t('organizations'))),
                  for (final m in list)
                    ListTile(title: Text(m.tenantName), subtitle: Text(m.role.json ?? '')),
                ],
              ),
      ),
    );
  }
}
