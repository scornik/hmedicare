// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'reorder_queue_request.g.dart';

@JsonSerializable()
class ReorderQueueRequest {
  const ReorderQueueRequest({
    required this.expectedQueueOrderVersion,
    required this.orderedSerialIds,
  });
  
  factory ReorderQueueRequest.fromJson(Map<String, Object?> json) => _$ReorderQueueRequestFromJson(json);
  
  final int expectedQueueOrderVersion;

  /// The serials to reposition, in the desired order. It need not list every active serial: the multiset of their current positions is reassigned in this order and the others keep theirs (QUEUE §5.3)
  final List<String> orderedSerialIds;

  Map<String, Object?> toJson() => _$ReorderQueueRequestToJson(this);
}
