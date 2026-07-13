import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';

class AuthPage extends ConsumerStatefulWidget { const AuthPage({super.key}); @override ConsumerState<AuthPage> createState()=>_AuthPageState(); }
class _AuthPageState extends ConsumerState<AuthPage> {
  bool register=false,loading=false; final student=TextEditingController(),password=TextEditingController(),name=TextEditingController(),department=TextEditingController(); int grade=1;
  Future<void> submit() async { setState(()=>loading=true); try { final path=register?'/auth/register':'/auth/login'; final data={'student_id':student.text,'password':password.text,if(register)'name':name.text,if(register)'department':department.text,if(register)'grade':grade}; final r=await ref.read(apiProvider).post(path,data:data); final token=r.data['access_token'] as String; await secureStorage.write(key:'token',value:token);ref.read(authProvider.notifier).setToken(token); } catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('입력 정보 또는 서버 연결을 확인해주세요.')));} finally{if(mounted)setState(()=>loading=false);} }
  @override Widget build(BuildContext context)=>Scaffold(body:SafeArea(child:Center(child:SingleChildScrollView(padding:const EdgeInsets.all(24),child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:440),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    Icon(Icons.calendar_month_rounded,size:72,color:Theme.of(context).colorScheme.primary),const SizedBox(height:16),Text('KMU Smart Scheduler',textAlign:TextAlign.center,style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.bold)),const SizedBox(height:32),
    TextField(controller:student,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'학번',prefixIcon:Icon(Icons.badge_outlined),border:OutlineInputBorder())),const SizedBox(height:12),
    if(register)...[TextField(controller:name,decoration:const InputDecoration(labelText:'이름',border:OutlineInputBorder())),const SizedBox(height:12),TextField(controller:department,decoration:const InputDecoration(labelText:'학과',border:OutlineInputBorder())),const SizedBox(height:12),DropdownButtonFormField<int>(value:grade,decoration:const InputDecoration(labelText:'학년',border:OutlineInputBorder()),items=[1,2,3,4,5,6].map((x)=>DropdownMenuItem(value:x,child:Text('$x학년'))).toList(),onChanged:(x)=>grade=x??1),const SizedBox(height:12)],
    TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'비밀번호 (8자 이상)',prefixIcon:Icon(Icons.lock_outline),border:OutlineInputBorder())),const SizedBox(height:20),FilledButton(onPressed:loading?null:submit,child:Padding(padding:const EdgeInsets.all(14),child:Text(loading?'처리 중...':register?'회원가입':'로그인'))),TextButton(onPressed:()=>setState(()=>register=!register),child:Text(register?'이미 계정이 있어요':'처음이신가요? 간단 회원가입'))
  ]))))));
}

