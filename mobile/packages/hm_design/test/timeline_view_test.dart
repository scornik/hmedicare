import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_design/hm_design.dart';

HmTimelineView view(String key, Future<TimelineReadPage> Function(String?) load) => HmTimelineView(
  key: ValueKey(key),
  load: load,
  title: 'Timeline',
  empty: 'Empty',
  failed: 'Failed',
  staleLabel: 'Updating',
  more: 'More',
  refresh: 'Refresh',
);
void main() {
  testWidgets('pages, renders Dhaka time, and clears records after access failure', (tester) async {
    var denied = false;
    final cursors = <String?>[];
    Future<TimelineReadPage> load(String? cursor) async {
      cursors.add(cursor);
      if (denied) throw StateError('403');
      return TimelineReadPage(
        [
          TimelineRecord(
            cursor ?? 'one',
            cursor == null ? 'Approved' : 'Removed',
            DateTime.utc(2026, 10, 7, 19, 30),
          ),
        ],
        cursor == null ? 'next' : null,
        true,
      );
    }

    await tester.pumpWidget(MaterialApp(home: view('patient1', load)));
    await tester.pumpAndSettle();
    expect(find.text('Approved'), findsOneWidget);
    expect(find.text('2026-10-08 01:30'), findsOneWidget);
    expect(find.text('Updating'), findsOneWidget);
    await tester.tap(find.text('More'));
    await tester.pumpAndSettle();
    expect(cursors, [null, 'next']);
    expect(find.text('Removed'), findsOneWidget);
    denied = true;
    await tester.tap(find.byTooltip('Refresh'));
    await tester.pumpAndSettle();
    expect(find.text('Failed'), findsOneWidget);
    expect(find.text('Approved'), findsNothing);
    expect(find.text('Removed'), findsNothing);
  });
  testWidgets('context switching discards late previous-context responses', (tester) async {
    final first = Completer<TimelineReadPage>();
    await tester.pumpWidget(MaterialApp(home: view('patient1', (_) => first.future)));
    await tester.pump();
    await tester.pumpWidget(
      MaterialApp(
        home: view(
          'patient2',
          (_) async =>
              TimelineReadPage([TimelineRecord('new', 'New patient', DateTime.utc(2026))], null, false),
        ),
      ),
    );
    await tester.pumpAndSettle();
    first.complete(TimelineReadPage([TimelineRecord('old', 'Old patient', DateTime.utc(2026))], null, false));
    await tester.pumpAndSettle();
    expect(find.text('New patient'), findsOneWidget);
    expect(find.text('Old patient'), findsNothing);
  });
}
