import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_api/hm_api.dart' as api;
import 'package:hm_auth/hm_auth.dart';
import 'package:patient_app/app.dart';

class FakeRepo implements AuthRepository {
  String? phone;
  int otpRequests = 0;
  bool loggedOut = false;
  String? _access;

  @override
  String? get accessToken => _access;

  @override
  AuthUser? get user => _access == null ? null : const AuthUser(id: 'u', phoneMasked: '+88017******01');

  @override
  Future<bool> restore() async => false;

  @override
  Future<OtpHint> requestOtp({required String phoneE164, required String localeTag}) async {
    phone = phoneE164;
    otpRequests++;
    return OtpHint.sent;
  }

  @override
  Future<void> verifyOtp({required String phoneE164, required String code}) async {
    if (code != '123456') throw Exception('bad code');
    _access = 'access';
  }

  @override
  Future<void> passwordLogin({required String email, required String password}) async {}

  @override
  Future<bool> refresh() async => false;

  @override
  Future<void> logout() async {
    loggedOut = true;
    _access = null;
  }
}

class EmptyContexts implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? b, Future<void>? c) async =>
      ResponseBody.fromString(
        jsonEncode({
          'data': <Object>[],
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
  testWidgets('phone → OTP (mock) → contexts → logout, Bangla by default, resend locked 30 s', (
    tester,
  ) async {
    final repo = FakeRepo();
    final dio = api.createHmDio(baseUrl: 'http://api.test')..httpClientAdapter = EmptyContexts();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(repo),
          apiClientProvider.overrideWithValue(api.HmApiClient(dio)),
        ],
        child: const PatientApp(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('মোবাইল নম্বর'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('phone')), '12345');
    await tester.tap(find.byKey(const Key('sendCode')));
    await tester.pumpAndSettle();
    expect(find.text('সঠিক বাংলাদেশি মোবাইল নম্বর দিন।'), findsOneWidget);
    expect(repo.otpRequests, 0);

    await tester.enterText(find.byKey(const Key('phone')), '০১৭০০০০০০০১');
    await tester.tap(find.byKey(const Key('sendCode')));
    await tester.pumpAndSettle();
    expect(repo.phone, '+8801700000001');
    expect(find.text('কোড পাঠানো হয়েছে।'), findsOneWidget);
    expect(tester.widget<TextButton>(find.byKey(const Key('resend'))).onPressed, isNull);
    await tester.pump(const Duration(seconds: 31));
    expect(tester.widget<TextButton>(find.byKey(const Key('resend'))).onPressed, isNotNull);
    expect(repo.otpRequests, 1, reason: 'never auto-resent');

    await tester.enterText(find.byKey(const Key('code')), '123456');
    await tester.tap(find.byKey(const Key('verify')));
    await tester.pumpAndSettle();
    expect(find.text('এখনও কোনো ক্লিনিকের সাথে যুক্ত নন।'), findsOneWidget);

    await tester.tap(find.byKey(const Key('logout')));
    await tester.pumpAndSettle();
    expect(repo.loggedOut, isTrue);
    expect(find.byKey(const Key('phone')), findsOneWidget);
  });
}
