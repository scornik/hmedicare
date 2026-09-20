// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'counts.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Counts _$CountsFromJson(Map<String, dynamic> json) => Counts(
  booked: (json['booked'] as num).toInt(),
  nonCancelled: (json['nonCancelled'] as num).toInt(),
  walkIns: (json['walkIns'] as num).toInt(),
);

Map<String, dynamic> _$CountsToJson(Counts instance) => <String, dynamic>{
  'booked': instance.booked,
  'nonCancelled': instance.nonCancelled,
  'walkIns': instance.walkIns,
};
