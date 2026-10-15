// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'ai_model_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AiModelList _$AiModelListFromJson(Map<String, dynamic> json) => AiModelList(
  items: (json['items'] as List<dynamic>)
      .map((e) => AiModel.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$AiModelListToJson(AiModelList instance) =>
    <String, dynamic>{'items': instance.items};
