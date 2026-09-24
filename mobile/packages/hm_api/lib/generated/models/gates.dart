// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'gate_code.dart';

part 'gates.g.dart';

@JsonSerializable()
class Gates {
  const Gates({
    required this.attested,
    required this.gateCode,
    required this.recordedAt,
    required this.recordedByUserId,
  });
  
  factory Gates.fromJson(Map<String, Object?> json) => _$GatesFromJson(json);
  
  final bool attested;
  final GateCode gateCode;
  final DateTime? recordedAt;
  final String? recordedByUserId;

  Map<String, Object?> toJson() => _$GatesToJson(this);
}
