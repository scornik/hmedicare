import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:doctor_app/active_tenant.dart';
import 'package:doctor_app/ai_accounts_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_api/hm_api.dart' as hm;
import 'package:hm_auth/hm_auth.dart';

const tenant = '00000000-0000-4000-8000-000000000001';
const doctor = '00000000-0000-4000-8000-000000000002';
const credentialId = '00000000-0000-4000-8000-000000000003';
const ackId = '00000000-0000-4000-8000-000000000004';
const secret = 'synthetic-provider-key-123456789';

class TestTenant extends ActiveTenant {
  @override
  String? build() => tenant;
}

class AccountAdapter implements HttpClientAdapter {
  bool unknown = false;
  bool unknownCreate = false;
  int acknowledgements = 0, creates = 0;
  Map<String, dynamic>? account, saved;
  Completer<void>? waitForAck;
  final actions = <String>[];
  final stamp = DateTime.now().toUtc().toIso8601String();
  @override
  void close({bool force = false}) {}
  ResponseBody json(Object? data, [int status = 200]) => ResponseBody.fromString(
    jsonEncode(
      status == 200
          ? {
              'data': data,
              'meta': {'requestId': tenant},
            }
          : data,
    ),
    status,
    headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    },
  );
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? b, Future<void>? c) async {
    expect(o.headers['X-Tenant-ID'], tenant);
    switch (o.path) {
      case '/api/v1/me/ai/credentials':
        return json({
          'doctorProfileId': doctor,
          'items': [if (account != null) account],
        });
      case '/api/v1/tenant/ai-policy':
        return json({
          'aiEnabled': true,
          'freeTierAiAllowed': false,
          'freeTierEffective': false,
          'freeTierForcedOffByProductionGate': false,
          'minimizationRequiredForNoTraining': true,
          'rawOutputRetentionDays': 30,
          'allowedProviderCodes': ['mock'],
          'minAiConsentPolicyVersion': 1,
          'policyTextVersion': '1',
          'policyVersion': 1,
          'rowVersion': 1,
          'decidedByUserId': null,
          'decidedAt': null,
        });
      case '/api/v1/ai/acknowledgement-texts':
        return json({
          'items': [
            for (final tier in ['PAID', 'FREE'])
              {
                'version': 'account-1',
                'tier': tier,
                'locale': 'en-BD',
                'body': 'SYNTHETIC $tier data-use statement',
                'sha256': 'a' * 64,
              },
          ],
        });
      case '/api/v1/ai/acknowledgements':
        acknowledgements++;
        final body = jsonDecode(jsonEncode(o.data)) as Map;
        expect(body['doctorProfileId'], doctor);
        expect(body['termsTextVersion'], 'account-1');
        expect(body['tier'], 'PAID');
        expect(body['locale'], 'en-BD');
        if (waitForAck != null) await waitForAck!.future;
        if (unknown) return json({'code': 'INTERNAL_ERROR'}, 503);
        return json({
          'id': ackId,
          'doctorProfileId': doctor,
          'providerCode': 'mock',
          'tier': 'PAID',
          'termsTextVersion': 'account-1',
          'termsTextSha256': 'a' * 64,
          'acknowledgedByUserId': tenant,
          'acknowledgedAt': stamp,
          'revokedAt': null,
          'revokeReason': null,
          'rowVersion': 1,
        });
      case '/api/v1/doctors/$doctor/ai/credentials':
        creates++;
        saved = Map<String, dynamic>.from(jsonDecode(jsonEncode(o.data)) as Map);
        expect(acknowledgements, 1);
        account = {
          'id': credentialId,
          'doctorProfileId': doctor,
          'providerCode': 'mock',
          'declaredTier': 'PAID',
          'billingMode': 'DOCTOR_BYOK_PAID',
          'status': 'PENDING_VALIDATION',
          'secretLast4': '6789',
          'rowVersion': 1,
          'validatedAt': null,
          'lastErrorClass': null,
        };
        if (unknownCreate) return json({'code': 'INTERNAL_ERROR'}, 503);
        return json(account);
      case '/api/v1/doctors/$doctor/ai/credentials/$credentialId/actions':
        final body = jsonDecode(jsonEncode(o.data)) as Map;
        expect(body['expectedRowVersion'], account!['rowVersion']);
        actions.add(body['action'] as String);
        account = {
          ...account!,
          'rowVersion': (account!['rowVersion'] as int) + 1,
          'status': body['action'] == 'REVOKE' ? 'REVOKED' : 'PENDING_VALIDATION',
        };
        return json(account);
    }
    return json({'code': 'NOT_FOUND'}, 404);
  }
}

Future<void> mount(WidgetTester tester, AccountAdapter adapter) async {
  final dio = Dio(BaseOptions(baseUrl: 'https://synthetic.invalid'))..httpClientAdapter = adapter;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(hm.HmApiClient(dio)),
        activeTenantProvider.overrideWith(TestTenant.new),
      ],
      child: const MaterialApp(home: DoctorAiAccountsScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> fill(WidgetTester tester) async {
  await tester.tap(find.byType(DropdownButtonFormField<String>).first);
  await tester.pumpAndSettle();
  await tester.tap(find.text('mock').last);
  await tester.pumpAndSettle();
  expect(find.text('SYNTHETIC PAID data-use statement'), findsOneWidget);
  await tester.ensureVisible(find.byType(CheckboxListTile));
  await tester.pumpAndSettle();
  await tester.tap(find.byType(CheckboxListTile));
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const Key('ai-api-key')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const Key('ai-api-key')), secret);
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save account'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('reads the statement, clears the key, and sends versioned account actions', (tester) async {
    final adapter = AccountAdapter();
    await mount(tester, adapter);
    await fill(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Save account'));
    await tester.pumpAndSettle();
    expect(adapter.saved, containsPair('secret', secret));
    expect(adapter.saved, containsPair('dataUseAckId', ackId));
    expect(adapter.saved, containsPair('billingMode', 'DOCTOR_BYOK_PAID'));
    expect(tester.widget<TextField>(find.byKey(const Key('ai-api-key'))).controller!.text, isEmpty);
    await tester.ensureVisible(find.widgetWithText(TextButton, 'Request validation'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Request validation'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(TextButton, 'Revoke'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Revoke'));
    await tester.pumpAndSettle();
    expect(adapter.actions, ['REVALIDATE', 'REVOKE']);
    expect(adapter.account!['status'], 'REVOKED');
  });
  testWidgets('an unknown acknowledgement outcome never creates or retries a key', (tester) async {
    final adapter = AccountAdapter()..unknown = true;
    await mount(tester, adapter);
    await fill(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Save account'));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not be confirmed'), findsOneWidget);
    expect(adapter.creates, 0);
    expect(adapter.acknowledgements, 1);
    expect(tester.widget<TextField>(find.byKey(const Key('ai-api-key'))).controller!.text, isEmpty);
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save account')).onPressed, isNull);
  });
  testWidgets('a lost create response recovers through reads without a second key save', (tester) async {
    final adapter = AccountAdapter()..unknownCreate = true;
    await mount(tester, adapter);
    await fill(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Save account'));
    await tester.pumpAndSettle();
    expect(find.textContaining('could not be confirmed'), findsOneWidget);
    expect(adapter.creates, 1);
    await tester.ensureVisible(find.widgetWithText(TextButton, 'Refresh accounts'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(TextButton, 'Refresh accounts'));
    await tester.pumpAndSettle();
    expect(find.textContaining('PENDING_VALIDATION'), findsOneWidget);
    expect(adapter.creates, 1);
    expect(adapter.acknowledgements, 1);
  });
  testWidgets('leaving during acknowledgement prevents the later key save', (tester) async {
    final adapter = AccountAdapter()..waitForAck = Completer<void>();
    await mount(tester, adapter);
    await fill(tester);
    await tester.tap(find.widgetWithText(FilledButton, 'Save account'));
    await tester.pump();
    await tester.pumpWidget(const SizedBox());
    adapter.waitForAck!.complete();
    await tester.pumpAndSettle();
    expect(adapter.acknowledgements, 1);
    expect(adapter.creates, 0);
    expect(tester.takeException(), isNull);
  });
}
