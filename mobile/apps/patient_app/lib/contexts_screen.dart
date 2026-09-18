import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' show PatientContext;
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_localization/hm_localization.dart';

/// `GET /me/patient-contexts` (tenant picker / profile switcher shell; empty until Stage 5).
final patientContextsProvider = FutureProvider.autoDispose<List<PatientContext>>((ref) async {
  final r = await ref.read(apiClientProvider).me.listPatientContexts();
  return r.data;
});

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
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
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
                  for (final c in list)
                    ListTile(title: Text(c.patientDisplayName), subtitle: Text(c.tenantName)),
                ],
              ),
      ),
    );
  }
}
