// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'my_ai_credential_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MyAiCredentialList _$MyAiCredentialListFromJson(Map<String, dynamic> json) =>
    MyAiCredentialList(
      doctorProfileId: json['doctorProfileId'] as String,
      items: (json['items'] as List<dynamic>)
          .map((e) => AiCredential.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$MyAiCredentialListToJson(MyAiCredentialList instance) =>
    <String, dynamic>{
      'doctorProfileId': instance.doctorProfileId,
      'items': instance.items,
    };
