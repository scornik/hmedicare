// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'counts2.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Counts2 _$Counts2FromJson(Map<String, dynamic> json) => Counts2(
  called: (json['called'] as num).toInt(),
  completed: (json['completed'] as num).toInt(),
  inConsultation: (json['inConsultation'] as num).toInt(),
  totalSerials: (json['totalSerials'] as num).toInt(),
  waiting: (json['waiting'] as num).toInt(),
);

Map<String, dynamic> _$Counts2ToJson(Counts2 instance) => <String, dynamic>{
  'called': instance.called,
  'completed': instance.completed,
  'inConsultation': instance.inConsultation,
  'totalSerials': instance.totalSerials,
  'waiting': instance.waiting,
};
