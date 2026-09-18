import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' show ClientKind;
import 'package:hm_auth/hm_auth.dart';

import 'app.dart';

void main() {
  final wiring = AuthWiring(clientKind: ClientKind.android);
  runApp(
    ProviderScope(
      overrides: [
        authRepositoryProvider.overrideWithValue(wiring.repository),
        apiClientProvider.overrideWithValue(wiring.client),
      ],
      child: const PatientApp(),
    ),
  );
}
