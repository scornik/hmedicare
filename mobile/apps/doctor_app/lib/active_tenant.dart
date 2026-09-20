import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_core/hm_core.dart';

/// The tenant the doctor is acting in, chosen from their memberships on the home screen and sent as
/// `X-Tenant-ID` on every call. The server re-validates the membership and its permissions on every
/// request, so nothing held here is authorization.
class ActiveTenant extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? tenantId) => state = tenantId;
}

final activeTenantProvider = NotifierProvider<ActiveTenant, String?>(ActiveTenant.new);

/// One read cache per app session (cleared on logout and when the tenant changes).
final readCacheProvider = Provider<ReadCache>((ref) => ReadCache());
