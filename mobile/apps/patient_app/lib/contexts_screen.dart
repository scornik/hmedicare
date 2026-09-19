import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_api/hm_api.dart' show PatientContext;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_localization/hm_localization.dart';

import 'active_context.dart';

/// `GET /me/patient-contexts`: the profile switcher (own record per clinic + dependents as guardian).
final patientContextsProvider = FutureProvider.autoDispose<List<PatientContext>>((ref) async {
  final r = await ref.read(apiClientProvider).me.listPatientContexts();
  return r.data;
});

String relationshipLabel(HmStrings s, String relationship) {
  final key = 'rel$relationship';
  final v = s.t(key);
  return v == key ? relationship : v;
}

class PatientContextsScreen extends ConsumerWidget {
  const PatientContextsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = HmStrings.of(context);
    final user = ref.watch(authControllerProvider).user;
    final contexts = ref.watch(patientContextsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(user?.phoneMasked ?? s.t('home')),
        actions: [
          IconButton(
            key: const Key('logout'),
            tooltip: s.t('logout'),
            icon: const Icon(Icons.logout),
            onPressed: () {
              ref.read(readCacheProvider).clear();
              ref.read(activeContextProvider.notifier).select(null);
              ref.read(authControllerProvider.notifier).logout();
            },
          ),
        ],
      ),
      body: contexts.when(
        loading: () => Center(child: Text(s.t('loading'))),
        error: (_, _) => Center(child: Text(s.t('error'))),
        data: (list) => list.isEmpty
            ? Center(child: Text(s.t('noClinics')))
            : ListView(
                children: [
                  ListTile(title: Text(s.t('selectProfile'))),
                  for (final c in list)
                    ListTile(
                      key: Key('context-${c.patientId}'),
                      leading: Icon(c.relationship == 'SELF' ? Icons.person : Icons.family_restroom),
                      title: Text(c.patientDisplayName),
                      subtitle: Text('${c.tenantName} · ${relationshipLabel(s, c.relationship)}'),
                      trailing: const Icon(Icons.chevron_right),
                      onTap: () {
                        ref.read(readCacheProvider).clear();
                        ref.read(activeContextProvider.notifier).select(c);
                        context.go('/profile');
                      },
                    ),
                ],
              ),
      ),
    );
  }
}
