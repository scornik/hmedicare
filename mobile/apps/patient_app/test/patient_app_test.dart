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

const tenant = '00000000-0000-4000-8000-00000000000a';
const patientId = '00000000-0000-4000-8000-000000000101';

/// Mocked API: one SELF context and its patient record; `offline` makes every call fail like a dropped link.
class FakeApi implements HttpClientAdapter {
  bool offline = false;
  int patientReads = 0;
  final List<RequestOptions> requests = [];

  static ResponseBody _json(Object body, [int status = 200]) => ResponseBody.fromString(
    jsonEncode(body),
    status,
    headers: {
      Headers.contentTypeHeader: ['application/json'],
    },
  );

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? b, Future<void>? c) async {
    requests.add(o);
    if (offline) {
      throw DioException.connectionError(requestOptions: o, reason: 'offline');
    }
    if (o.path.endsWith('/me/patient-contexts')) {
      return _json({
        'data': [
          {
            'tenantId': tenant,
            'tenantName': 'DEMO Clinic',
            'patientId': patientId,
            'patientDisplayName': 'রহিমা খাতুন',
            'relationship': 'SELF',
            'authorityScope': <String>[],
          },
        ],
        'meta': {'requestId': 'rq'},
      });
    }
    if (o.path.endsWith('/patients/$patientId')) {
      patientReads++;
      return _json({
        'data': {
          'id': patientId,
          'medicalRecordNumber': 'P-0001-AAAA-BBBB-CCCC',
          'legalName': 'Rahima Khatun',
          'legalNameBn': 'রহিমা খাতুন',
          'displayName': 'Rahima Khatun',
          'dateOfBirth': null,
          'birthYear': 1990,
          'sex': 'FEMALE',
          'genderIdentity': null,
          'address': null,
          'preferredLocale': 'bn-BD',
          'status': 'ACTIVE',
          'mergedIntoPatientId': null,
          'contacts': [
            {
              'id': '00000000-0000-4000-8000-000000000301',
              'type': 'PHONE',
              'displayValue': '+8801*******01',
              'verificationStatus': 'VERIFIED',
              'isPreferred': true,
              'relationship': 'SELF',
              'status': 'ACTIVE',
              'rowVersion': 1,
            },
          ],
          'createdAt': '2026-09-19T00:00:00.000Z',
          'updatedAt': '2026-09-19T00:00:00.000Z',
          'rowVersion': 1,
        },
        'meta': {'requestId': 'rq'},
      });
    }
    return _json({'code': 'NOT_FOUND', 'message': 'x', 'requestId': 'rq'}, 404);
  }

  @override
  void close({bool force = false}) {}
}

Future<(FakeRepo, FakeApi)> pumpApp(WidgetTester tester) async {
  final repo = FakeRepo();
  final fake = FakeApi();
  final dio = api.createHmDio(baseUrl: 'http://api.test')..httpClientAdapter = fake;
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
  return (repo, fake);
}

Future<void> otpLogin(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('phone')), '০১৭০০০০০০০১');
  await tester.tap(find.byKey(const Key('sendCode')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('code')), '123456');
  await tester.tap(find.byKey(const Key('verify')));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('phone → OTP (mock) → contexts → logout, Bangla by default, resend locked 30 s', (
    tester,
  ) async {
    final (repo, fake) = await pumpApp(tester);
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
    expect(find.text('প্রোফাইল বেছে নিন'), findsOneWidget);
    expect(find.text('DEMO Clinic · নিজের'), findsOneWidget);

    await tester.tap(find.byKey(const Key('logout')));
    await tester.pumpAndSettle();
    expect(repo.loggedOut, isTrue);
    expect(find.byKey(const Key('phone')), findsOneWidget);
  });

  testWidgets('profile switcher sends X-Patient-Context; offline shows the saved copy as stale', (
    tester,
  ) async {
    final (_, fake) = await pumpApp(tester);
    await otpLogin(tester);
    await tester.tap(find.byKey(const Key('context-$patientId')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mrn')), findsOneWidget);
    expect(find.text('P-0001-AAAA-BBBB-CCCC'), findsOneWidget);
    expect(find.text('+8801*******01'), findsOneWidget);
    expect(find.text('এইমাত্র হালনাগাদ'), findsOneWidget);
    final read = fake.requests.last;
    expect(read.path, endsWith('/patients/$patientId'));
    expect(read.headers['X-Tenant-ID'], tenant);
    expect(read.headers['X-Patient-Context'], patientId);
    expect(fake.patientReads, 1);

    // The link drops: refresh serves the saved copy with the staleness indicator (no mutation involved).
    fake.offline = true;
    await tester.tap(find.byKey(const Key('refresh')));
    await tester.pumpAndSettle();
    expect(find.text('P-0001-AAAA-BBBB-CCCC'), findsOneWidget);
    expect(find.textContaining('অফলাইন — সংরক্ষিত কপি দেখানো হচ্ছে'), findsOneWidget);
    expect(fake.patientReads, 1, reason: 'the failed fetch never reached the handler');

    // Switching profile clears the cache; without a network the profile shows the offline state.
    await tester.tap(find.byKey(const Key('switchProfile')));
    await tester.pumpAndSettle();
    expect(find.text('প্রোফাইল বেছে নিন'), findsNothing, reason: 'contexts list needs the network');
  });
}
