import 'package:flutter/material.dart';

class TimelineRecord {
  const TimelineRecord(this.id, this.label, this.occurredAt);
  final String id, label;
  final DateTime occurredAt;
}

class TimelineReadPage {
  const TimelineReadPage(this.items, this.nextCursor, this.stale);
  final List<TimelineRecord> items;
  final String? nextCursor;
  final bool stale;
}

/// Online, session-only history. Callers key this widget by authenticated user, tenant and patient.
class HmTimelineView extends StatefulWidget {
  const HmTimelineView({
    super.key,
    required this.load,
    required this.title,
    required this.empty,
    required this.failed,
    required this.staleLabel,
    required this.more,
    required this.refresh,
  });
  final Future<TimelineReadPage> Function(String? cursor) load;
  final String title, empty, failed, staleLabel, more, refresh;
  @override
  State<HmTimelineView> createState() => _HmTimelineViewState();
}

class _HmTimelineViewState extends State<HmTimelineView> {
  final _items = <TimelineRecord>[];
  String? _cursor;
  bool _loading = false, _failed = false, _stale = false;
  @override
  void initState() {
    super.initState();
    _read(reset: true);
  }

  Future<void> _read({bool reset = false}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _failed = false;
      if (reset) {
        _items.clear();
        _cursor = null;
        _stale = false;
      }
    });
    try {
      final page = await widget.load(_cursor);
      if (!mounted) return;
      setState(() {
        final ids = _items.map((i) => i.id).toSet();
        _items.addAll(page.items.where((i) => !ids.contains(i.id)));
        _cursor = page.nextCursor;
        _stale = _stale || page.stale;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _items.clear();
        _cursor = null;
        _failed = true;
        _stale = false;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.title),
      actions: [
        IconButton(
          tooltip: widget.refresh,
          onPressed: _loading ? null : () => _read(reset: true),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_stale) Text(widget.staleLabel, key: const Key('timelineStale')),
        if (_failed) Text(widget.failed, key: const Key('timelineError')),
        if (!_loading && !_failed && _items.isEmpty) Text(widget.empty),
        for (final item in _items)
          ListTile(key: Key(item.id), title: Text(item.label), subtitle: Text(_date(item.occurredAt))),
        if (_loading) const Center(child: CircularProgressIndicator()),
        if (_cursor != null)
          FilledButton(onPressed: _loading ? null : () => _read(), child: Text(widget.more)),
      ],
    ),
  );
  String _date(DateTime value) {
    final d = value.toUtc().add(const Duration(hours: 6));
    String two(int v) => '$v'.padLeft(2, '0');
    return '${d.year}-${two(d.month)}-${two(d.day)} ${two(d.hour)}:${two(d.minute)}';
  }
}
