import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_design/hm_design.dart';
import 'package:hm_localization/hm_localization.dart';

import 'contexts_screen.dart';
import 'login_screen.dart';

/// Bridges auth state to GoRouter redirects (UX only; the API authorizes every call).
class _AuthListenable extends ChangeNotifier {
  void ping() => notifyListeners();
}

class PatientApp extends ConsumerStatefulWidget {
  const PatientApp({super.key});

  @override
  ConsumerState<PatientApp> createState() => _PatientAppState();
}

class _PatientAppState extends ConsumerState<PatientApp> {
  final _auth = _AuthListenable();
  late final GoRouter _router = GoRouter(
    initialLocation: '/login',
    refreshListenable: _auth,
    redirect: (context, state) {
      final status = ref.read(authControllerProvider).status;
      final atLogin = state.matchedLocation == '/login';
      if (status == AuthStatus.unknown) return null;
      if (status == AuthStatus.signedOut && !atLogin) return '/login';
      if (status == AuthStatus.signedIn && atLogin) return '/contexts';
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (_, _) => const PatientLoginScreen()),
      GoRoute(path: '/contexts', builder: (_, _) => const PatientContextsScreen()),
    ],
  );

  @override
  void dispose() {
    _auth.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authControllerProvider, (_, _) => _auth.ping());
    final locale = ref.watch(localeProvider);
    return MaterialApp.router(
      onGenerateTitle: (c) => HmStrings.of(c).t('patientApp'),
      theme: HmTheme.light(),
      darkTheme: HmTheme.dark(),
      locale: locale,
      supportedLocales: supportedLocales,
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: _router,
    );
  }
}
