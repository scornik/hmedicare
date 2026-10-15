// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_job_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiJobList _$AiJobListFromJson(Map<String, dynamic> json) => AiJobList(
  items: (json['items'] as List<dynamic>)
      .map((e) => AiJob.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiJobListToJson(AiJobList instance) => <String, dynamic>{
  'items': instance.items,
};
