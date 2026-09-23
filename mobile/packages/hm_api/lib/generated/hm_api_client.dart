// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:dio/dio.dart';

import 'clients/appointments_client.dart';
import 'clients/auth_client.dart';
import 'clients/care_team_client.dart';
import 'clients/chamber_days_client.dart';
import 'clients/queue_client.dart';
import 'clients/chambers_client.dart';
import 'clients/clinics_client.dart';
import 'clients/patients_client.dart';
import 'clients/encounters_client.dart';
import 'clients/tenant_client.dart';
import 'clients/guardianships_client.dart';
import 'clients/me_client.dart';
import 'clients/serials_client.dart';
import 'clients/patient_accounts_client.dart';
import 'clients/platform_client.dart';
import 'clients/health_client.dart';

/// HMedic API `v1.0.0`.
///
/// HMedic clinic platform API. Generated from packages/contracts (do not edit the JSON by hand). Business routes live under /api/v1; health routes at the root.
class HmApiClient {
  HmApiClient(
    Dio dio, {
    String? baseUrl,
  })  : _dio = dio,
        _baseUrl = baseUrl;

  final Dio _dio;
  final String? _baseUrl;

  static String get version => '1.0.0';

  AppointmentsClient? _appointments;
  AuthClient? _auth;
  CareTeamClient? _careTeam;
  ChamberDaysClient? _chamberDays;
  QueueClient? _queue;
  ChambersClient? _chambers;
  ClinicsClient? _clinics;
  PatientsClient? _patients;
  EncountersClient? _encounters;
  TenantClient? _tenant;
  GuardianshipsClient? _guardianships;
  MeClient? _me;
  SerialsClient? _serials;
  PatientAccountsClient? _patientAccounts;
  PlatformClient? _platform;
  HealthClient? _health;

  AppointmentsClient get appointments => _appointments ??= AppointmentsClient(_dio, baseUrl: _baseUrl);

  AuthClient get auth => _auth ??= AuthClient(_dio, baseUrl: _baseUrl);

  CareTeamClient get careTeam => _careTeam ??= CareTeamClient(_dio, baseUrl: _baseUrl);

  ChamberDaysClient get chamberDays => _chamberDays ??= ChamberDaysClient(_dio, baseUrl: _baseUrl);

  QueueClient get queue => _queue ??= QueueClient(_dio, baseUrl: _baseUrl);

  ChambersClient get chambers => _chambers ??= ChambersClient(_dio, baseUrl: _baseUrl);

  ClinicsClient get clinics => _clinics ??= ClinicsClient(_dio, baseUrl: _baseUrl);

  PatientsClient get patients => _patients ??= PatientsClient(_dio, baseUrl: _baseUrl);

  EncountersClient get encounters => _encounters ??= EncountersClient(_dio, baseUrl: _baseUrl);

  TenantClient get tenant => _tenant ??= TenantClient(_dio, baseUrl: _baseUrl);

  GuardianshipsClient get guardianships => _guardianships ??= GuardianshipsClient(_dio, baseUrl: _baseUrl);

  MeClient get me => _me ??= MeClient(_dio, baseUrl: _baseUrl);

  SerialsClient get serials => _serials ??= SerialsClient(_dio, baseUrl: _baseUrl);

  PatientAccountsClient get patientAccounts => _patientAccounts ??= PatientAccountsClient(_dio, baseUrl: _baseUrl);

  PlatformClient get platform => _platform ??= PlatformClient(_dio, baseUrl: _baseUrl);

  HealthClient get health => _health ??= HealthClient(_dio, baseUrl: _baseUrl);
}
