// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'step_up_verify_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StepUpVerifyResponse _$StepUpVerifyResponseFromJson(
  Map<String, dynamic> json,
) => StepUpVerifyResponse(
  authnMethods: (json['authnMethods'] as List<dynamic>)
      .map((e) => StepUpVerifyResponseAuthnMethods.fromJson(e as String))
      .toList(),
);

Map<String, dynamic> _$StepUpVerifyResponseToJson(
  StepUpVerifyResponse instance,
) => <String, dynamic>{'authnMethods': instance.authnMethods};
