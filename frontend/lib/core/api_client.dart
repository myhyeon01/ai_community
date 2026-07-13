import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthState { final String? token; const AuthState(this.token); }
class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier():super(const AuthState(null));
  void setToken(String value)=>state=AuthState(value);
  void logout()=>state=const AuthState(null);
}
final authProvider=StateNotifierProvider<AuthNotifier,AuthState>((ref)=>AuthNotifier());
final apiProvider=Provider((ref){
  final dio=Dio(BaseOptions(baseUrl:const String.fromEnvironment('API_URL',defaultValue:'http://10.0.2.2:8000/api/v1'),connectTimeout:const Duration(seconds:10)));
  dio.interceptors.add(InterceptorsWrapper(onRequest:(o,h){final t=ref.read(authProvider).token;if(t!=null)o.headers['Authorization']='Bearer $t';h.next(o);}));
  return dio;
});
const secureStorage=FlutterSecureStorage();

