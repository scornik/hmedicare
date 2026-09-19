import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_api/hm_api.dart' show PatientContext;
import 'package:hm_core/hm_core.dart';

/// The profile the patient user is acting as (AUTHORIZATION-MATRIX §4): sent as `X-Tenant-ID` +
/// `X-Patient-Context` on every patient read. Chosen per launch from `GET /me/patient-contexts`; the server
/// re-validates the link on every request, so nothing here is authorization.
class ActiveContext extends Notifier<PatientContext?> {
  @override
  PatientContext? build() => null;

  void select(PatientContext? c) => state = c;
}

final activeContextProvider = NotifierProvider<ActiveContext, PatientContext?>(ActiveContext.new);

/// One read cache per app session (cleared on logout and on profile switch).
final readCacheProvider = Provider<ReadCache>((ref) => ReadCache());
