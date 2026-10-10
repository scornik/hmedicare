// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'data.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Data _$DataFromJson(Map<String, dynamic> json) => Data(
  patientId: json['patientId'] as String,
  targetType: TargetType.fromJson(json['targetType'] as String),
);

Map<String, dynamic> _$DataToJson(Data instance) => <String, dynamic>{
  'patientId': instance.patientId,
  'targetType': instance.targetType,
};
