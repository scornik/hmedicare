import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:doctor_app/app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_api/hm_api.dart' as api;
import 'package:hm_auth/hm_auth.dart';

class FakeRepo implements AuthRepository {
  bool loggedOut = false;
  String? _access;

  @override
  String? get accessToken => _access;

  @override
  AuthUser? get user => _access == null ? null : const AuthUser(id: 'u', displayName: 'Demo Doctor');

  @override
  Future<bool> restore() async => false;

  @override
  Future<OtpHint> requestOtp({required String phoneE164, required String localeTag}) async => OtpHint.sent;

  @override
  Future<void> verifyOtp({required String phoneE164, required String code}) async {}

  @override
  Future<void> passwordLogin({required String email, required String password}) async {
    if (password != 'not-a-real-password') throw Exception('INVALID_CREDENTIALS');
    _access = 'access';
  }

  @override
  Future<bool> refresh() async => false;

  @override
  Future<void> logout() async {
    loggedOut = true;
    _access = null;
  }
}

class MeAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? b, Future<void>? c) async =>
      ResponseBody.fromString(
        jsonEncode({
          'data': {
            'user': {
              'id': '00000000-0000-4000-8000-000000000001',
              'displayName': 'Demo Doctor',
              'email': 'dr.a1@example.invalid',
              'phoneMasked': null,
              'emailVerified': true,
              'phoneVerified': false,
            },
            'memberships': [
              {
                'membershipId': '00000000-0000-4000-8000-00000000000b',
                'tenantId': '00000000-0000-4000-8000-00000000000a',
                'tenantName': 'Demo Clinic',
                'role': 'doctor',
              },
            ],
            'platformOperator': false,
          },
          'meta': {'requestId': 'rq'},
        }),
        200,
        headers: {
          Headers.contentTypeHeader: ['application/json'],
        },
      );

  @override
  void close({bool force = false}) {}
}

void main() {
  testWidgets('password login → memberships → logout; failure message; language toggle', (tester) async {
    final repo = FakeRepo();
    final dio = api.createHmDio(baseUrl: 'http://api.test')..httpClientAdapter = MeAdapter();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(repo),
          apiClientProvider.overrideWithValue(api.HmApiClient(dio)),
        ],
        child: const DoctorApp(),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('English'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsWidgets);

    await tester.enterText(find.byKey(const Key('email')), 'dr.a1@example.invalid');
    await tester.enterText(find.byKey(const Key('password')), 'wrong');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Sign-in failed. Check your details and try again.'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('password')), 'not-a-real-password');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Demo Clinic'), findsOneWidget);
    expect(find.text('doctor'), findsOneWidget);

    await tester.tap(find.byKey(const Key('logout')));
    await tester.pumpAndSettle();
    expect(repo.loggedOut, isTrue);
    expect(find.byKey(const Key('email')), findsOneWidget);
  });
}
