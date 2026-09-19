import 'api_problem.dart';

/// A read served through [ReadCache]: the value, when it was fetched, and whether it is a saved copy shown
/// because the network fetch failed (`stale`). Screens render a staleness indicator from these fields.
class CachedRead<T> {
  const CachedRead({required this.value, required this.fetchedAt, required this.stale});

  final T value;
  final DateTime fetchedAt;

  /// True when the latest fetch failed and the value is the last successful copy.
  final bool stale;

  Duration age(DateTime now) => now.difference(fetchedAt);
}

/// In-memory read-through cache for patient/queue reads (MOBILE-IMPLEMENTATION: reads cached with a
/// staleness indicator; mutations are online-only and never cached). Keys are per user session: the cache
/// is cleared on logout. Persistence across launches arrives with `hm_offline` (MOB-002).
class ReadCache {
  ReadCache({DateTime Function()? now}) : _now = now ?? DateTime.now;

  final DateTime Function() _now;
  final Map<String, CachedRead<Object?>> _entries = {};

  /// Fetches `key`; on a network failure ([ApiProblem] `NETWORK_UNAVAILABLE` or a transport error) returns
  /// the saved copy marked `stale`. Authorization and validation failures are never masked by the cache.
  Future<CachedRead<T>> readThrough<T>(String key, Future<T> Function() fetch) async {
    try {
      final value = await fetch();
      final entry = CachedRead<T>(value: value, fetchedAt: _now(), stale: false);
      _entries[key] = entry;
      return entry;
    } on Object catch (e) {
      final saved = _entries[key];
      if (saved != null && _isNetworkFailure(e)) {
        return CachedRead<T>(value: saved.value as T, fetchedAt: saved.fetchedAt, stale: true);
      }
      rethrow;
    }
  }

  CachedRead<T>? peek<T>(String key) => _entries[key] as CachedRead<T>?;

  void remove(String key) => _entries.remove(key);

  void clear() => _entries.clear();

  static bool _isNetworkFailure(Object e) {
    if (e is ApiProblem) return e.code == 'NETWORK_UNAVAILABLE';
    final s = e.toString();
    return s.contains('connection') || s.contains('SocketException') || s.contains('timeout');
  }
}
