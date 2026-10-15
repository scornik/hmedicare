import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:doctor_app/active_tenant.dart';
import 'package:doctor_app/ai_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_api/hm_api.dart' as hm;
import 'package:hm_auth/hm_auth.dart';

const tenant = '00000000-0000-4000-8000-000000000001';
const encounter = '00000000-0000-4000-8000-000000000002';
const credential = '00000000-0000-4000-8000-000000000003';
const job = '00000000-0000-4000-8000-000000000004';
const draft = '00000000-0000-4000-8000-000000000005';
const suggestion = '00000000-0000-4000-8000-000000000006';

class TestTenant extends ActiveTenant {
  @override
  String? build() => tenant;
}

class AiAdapter implements HttpClientAdapter {
  bool persisted = false;
  bool unknownApproval = false;
  int requests = 0;
  int version = 1;
  String status = 'PENDING';
  Map<String, dynamic>? approval;
  final stamp = DateTime.now().toUtc().toIso8601String();
  @override
  void close({bool force = false}) {}
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? b, Future<void>? c) async {
    Object data;
    switch (o.path) {
      case '/api/v1/tenant/ai-policy':
        data = {
          'aiEnabled': true,
          'freeTierAiAllowed': true,
          'freeTierEffective': true,
          'freeTierForcedOffByProductionGate': false,
          'allowedProviderCodes': ['mock'],
          'minimizationRequiredForNoTraining': true,
          'rawOutputRetentionDays': 30,
          'minAiConsentPolicyVersion': 1,
          'policyTextVersion': 'v1',
          'policyVersion': 1,
          'rowVersion': 1,
          'decidedAt': stamp,
          'decidedByUserId': tenant,
        };
      case '/api/v1/me/ai/credentials':
        data = {
          'doctorProfileId': tenant,
          'items': [
            {
              'id': credential,
              'doctorProfileId': tenant,
              'providerCode': 'mock',
              'declaredTier': 'FREE',
              'billingMode': 'DOCTOR_BYOK_FREE',
              'status': 'ACTIVE',
              'secretLast4': '6789',
              'rowVersion': 1,
              'validatedAt': stamp,
              'lastErrorClass': null,
            },
          ],
        };
      case '/api/v1/ai/models':
        data = {
          'items': [
            {
              'providerCode': 'mock',
              'modelId': 'synthetic-catalog-model',
              'displayName': 'Synthetic catalog model',
              'capabilities': ['text', 'json_schema'],
              'tierAvailability': ['FREE'],
              'contextTokens': null,
              'lastVerifiedAt': stamp,
              'source': 'PROVIDER_API',
            },
          ],
        };
      case '/api/v1/encounters/$encounter/ai/note-draft':
        requests++;
        data = jobData();
      case '/api/v1/encounters/$encounter/ai/jobs':
        data = {
          'items': persisted ? [jobData()] : [],
        };
      case '/api/v1/ai/jobs/$job':
        data = jobData();
      case '/api/v1/ai/drafts/$draft':
        data = draftData();
      case '/api/v1/ai/suggestions/$suggestion/review':
        version++;
        status = 'ACCEPTED';
        data = suggestionData();
      case '/api/v1/ai/suggestions/$suggestion/approve':
        approval = Map<String, dynamic>.from(jsonDecode(jsonEncode(o.data)) as Map);
        status = 'APPROVED';
        version++;
        if (unknownApproval) {
          return ResponseBody.fromString(
            '{"code":"INTERNAL_ERROR"}',
            503,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        data = {
          'id': tenant,
          'aiSuggestionId': suggestion,
          'approvedTarget': 'ENCOUNTER_NOTE_SECTION',
          'approvedRecordType': 'encounter_note',
          'approvedRecordId': encounter,
          'approvedSection': 'history',
          'attestationVersion': 1,
          'approvedAt': stamp,
        };
      default:
        return ResponseBody.fromString(
          '{}',
          404,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
    }
    return ResponseBody.fromString(
      jsonEncode({
        'data': data,
        'meta': {'requestId': 'synthetic-ui-test'},
      }),
      200,
      headers: {
        Headers.contentTypeHeader: [Headers.jsonContentType],
      },
    );
  }

  Map<String, Object?> jobData() => {
    'id': job,
    'draftId': draft,
    'encounterId': encounter,
    'purpose': 'NOTE_DRAFT',
    'status': 'SUCCEEDED',
    'providerCode': 'mock',
    'modelId': 'synthetic-catalog-model',
    'declaredTier': 'FREE',
    'effectiveDataUsePolicy': 'MAY_TRAIN_OR_REVIEW',
    'promptTemplateVersion': 'note-draft/v1',
    'errorClass': null,
    'errorReason': null,
    'cancelRequestedAt': null,
    'startedAt': stamp,
    'finishedAt': stamp,
    'rowVersion': 1,
  };
  Map<String, Object?> suggestionData() => {
    'id': suggestion,
    'suggestionType': 'NOTE_SECTION',
    'targetSection': 'history',
    'candidate': {'text': 'SYNTHETIC proposal'},
    'editedCandidate': null,
    'confidence': 'LOW',
    'status': status,
    'rowVersion': version,
    'reviewedAt': null,
    'sourceRefs': [
      {'sourceType': 'diagnosis', 'sourceId': tenant, 'occurredAt': stamp},
    ],
  };
  Map<String, Object?> draftData() => {
    'id': draft,
    'aiJobId': job,
    'encounterId': encounter,
    'draftType': 'NOTE_DRAFT',
    'status': 'IN_REVIEW',
    'outputSchemaVersion': 'note-draft/v1',
    'droppedUnsourcedCount': 0,
    'expiresAt': DateTime.now().add(const Duration(hours: 1)).toUtc().toIso8601String(),
    'openedAt': stamp,
    'closedAt': null,
    'rowVersion': 1,
    'suggestions': [suggestionData()],
  };
}

Future<void> mount(
  WidgetTester tester,
  AiAdapter adapter, {
  bool canWrite = true,
  Future<void> Function()? onApproved,
}) async {
  final dio = Dio(BaseOptions(baseUrl: 'https://synthetic.invalid'))..httpClientAdapter = adapter;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(hm.HmApiClient(dio)),
        activeTenantProvider.overrideWith(TestTenant.new),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: DoctorAiPanel(
              encounterId: encounter,
              canWrite: canWrite,
              noteRowVersion: 7,
              needsChartRefresh: false,
              onBusy: (_) {},
              onApproved: onApproved ?? () async {},
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> chooseModel(WidgetTester tester) async {
  final picker = find.byKey(const ValueKey('model-$credential-1'));
  await tester.ensureVisible(picker);
  await tester.tap(picker);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Synthetic catalog model').last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('native unknown approval outcome refreshes instead of retrying the write', (tester) async {
    final adapter = AiAdapter()..unknownApproval = true;
    var refreshed = 0;
    await mount(
      tester,
      adapter,
      onApproved: () async {
        refreshed++;
      },
    );
    await chooseModel(tester);
    final request = find.widgetWithText(FilledButton, 'Request suggestions');
    await tester.ensureVisible(request);
    await tester.tap(request);
    await tester.pumpAndSettle();
    final accept = find.widgetWithText(TextButton, 'Accept for review');
    await tester.ensureVisible(accept);
    await tester.tap(accept);
    await tester.pumpAndSettle();
    final attest = find.byType(CheckboxListTile);
    await tester.ensureVisible(attest);
    await tester.tap(attest);
    await tester.pumpAndSettle();
    final approve = find.widgetWithText(FilledButton, 'Approve this suggestion into the chart');
    await tester.ensureVisible(approve);
    await tester.tap(approve);
    await tester.pumpAndSettle();
    expect(refreshed, 1);
    expect(adapter.version, 3);
    expect(find.textContaining('could not be confirmed'), findsOneWidget);
    expect(approve, findsNothing);
  });
  testWidgets('native recent requests reopen a persisted draft without creating another job', (tester) async {
    final adapter = AiAdapter()..persisted = true;
    await mount(tester, adapter);
    final history = find.text('Recent AI requests');
    await tester.ensureVisible(history);
    await tester.tap(history);
    await tester.pumpAndSettle();
    final previous = find.textContaining('noteDraft · succeeded');
    await tester.ensureVisible(previous);
    await tester.tap(previous);
    await tester.pumpAndSettle();
    expect(find.text('SYNTHETIC proposal'), findsOneWidget);
    expect(adapter.requests, 0);
  });
  testWidgets('native AI requires review and attestation before one clinical approval', (tester) async {
    final adapter = AiAdapter();
    var refreshed = 0;
    await mount(
      tester,
      adapter,
      onApproved: () async {
        refreshed++;
      },
    );
    await chooseModel(tester);
    final request = find.widgetWithText(FilledButton, 'Request suggestions');
    await tester.ensureVisible(request);
    await tester.tap(request);
    await tester.pumpAndSettle();
    expect(find.textContaining('Provider may train'), findsOneWidget);
    expect(find.text('Low or unknown confidence — verify carefully.'), findsOneWidget);
    final accept = find.widgetWithText(TextButton, 'Accept for review');
    await tester.ensureVisible(accept);
    await tester.tap(accept);
    await tester.pumpAndSettle();
    final approve = find.widgetWithText(FilledButton, 'Approve this suggestion into the chart');
    expect(tester.widget<FilledButton>(approve).onPressed, isNull);
    final attest = find.byType(CheckboxListTile);
    await tester.ensureVisible(attest);
    await tester.tap(attest);
    await tester.pumpAndSettle();
    await tester.ensureVisible(approve);
    await tester.tap(approve);
    await tester.pumpAndSettle();
    expect(adapter.approval, containsPair('attestationVersion', 1));
    expect(adapter.approval, containsPair('expectedRowVersion', 2));
    expect(adapter.approval!['noteSection'], containsPair('expectedNoteRowVersion', 7));
    expect(refreshed, 1);
  });
  testWidgets('native AI cannot request while the consultation has unsaved text', (tester) async {
    final adapter = AiAdapter();
    await mount(tester, adapter, canWrite: false);
    await chooseModel(tester);
    expect(
      tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Request suggestions')).onPressed,
      isNull,
    );
    expect(adapter.requests, 0);
  });
}
