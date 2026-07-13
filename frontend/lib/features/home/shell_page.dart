import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/api_client.dart';
import '../calendar/calendar_page.dart';
import '../timetable/add_course_page.dart';

class ShellPage extends StatefulWidget { const ShellPage({super.key}); @override State<ShellPage> createState()=>_ShellPageState(); }
class _ShellPageState extends State<ShellPage>{
  int index=0;
  @override Widget build(BuildContext context){
    const pages=[HomePage(),CalendarPage(),AIPage(),NoticePage(),MyPage()];
    return Scaffold(body:IndexedStack(index:index,children:pages),bottomNavigationBar:NavigationBar(selectedIndex:index,onDestinationSelected:(x)=>setState(()=>index=x),destinations:const [NavigationDestination(icon:Icon(Icons.home_outlined),label:'홈'),NavigationDestination(icon:Icon(Icons.calendar_month_outlined),label:'캘린더'),NavigationDestination(icon:Icon(Icons.auto_awesome_outlined),label:'AI'),NavigationDestination(icon:Icon(Icons.notifications_outlined),label:'알림'),NavigationDestination(icon:Icon(Icons.person_outline),label:'MY')]));
  }
}
final todayProvider=FutureProvider.autoDispose<Map<String,dynamic>>((ref)async=>(await ref.read(apiProvider).get('/calendar/today')).data);
class HomePage extends ConsumerWidget{
  const HomePage({super.key});
  @override Widget build(BuildContext context,WidgetRef ref){
    final state=ref.watch(todayProvider);
    return Scaffold(appBar:AppBar(title:const Text('오늘'),actions:[IconButton(onPressed:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>const AddCoursePage())),icon:const Icon(Icons.add))]),body:RefreshIndicator(onRefresh:()=>ref.refresh(todayProvider.future),child:state.when(loading:()=>const Center(child:CircularProgressIndicator()),error:(_,__)=>ListView(children:const [SizedBox(height:180),Center(child:Text('일정을 불러오지 못했습니다.'))]),data:(data){
      final courses=(data['courses'] as List?)??[];
      return ListView(padding:const EdgeInsets.all(16),children:[Text(data['date']??'',style:Theme.of(context).textTheme.titleMedium),if(data['override_message']!=null)Card(color:Theme.of(context).colorScheme.primaryContainer,child:ListTile(leading:const Icon(Icons.change_circle_outlined),title:Text(data['override_message']))),const _Title('오늘 실제 시간표'),if(courses.isEmpty)const Card(child:ListTile(title:Text('오늘은 등록된 수업이 없습니다.'))),...courses.map((c)=>Card(child:ListTile(leading:const CircleAvatar(child:Icon(Icons.school_outlined)),title:Text(c['name']),subtitle:Text('${c['start_time'].toString().substring(0,5)}–${c['end_time'].toString().substring(0,5)} · ${c['classroom']}'),trailing:Text(c['professor'])))),const _Title('AI 일정'),const Card(child:ListTile(leading:Icon(Icons.auto_awesome),title:Text('공강 시간을 활용한 추천을 확인하세요')))]);
    })));
  }
}
class _Title extends StatelessWidget{final String text;const _Title(this.text);@override Widget build(BuildContext context)=>Padding(padding:const EdgeInsets.only(top:20,bottom:8),child:Text(text,style:Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight:FontWeight.bold)));}
class AIPage extends ConsumerWidget{const AIPage({super.key});@override Widget build(BuildContext context,WidgetRef ref)=>Scaffold(appBar:AppBar(title:const Text('AI 플래너')),body:Center(child:FilledButton.icon(onPressed:()async{final r=await ref.read(apiProvider).get('/ai/today');if(context.mounted)showDialog(context:context,builder:(_)=>AlertDialog(title:const Text('오늘의 추천'),content:Text(r.data.toString())));},icon:const Icon(Icons.auto_awesome),label:const Text('오늘 일정 추천받기'))));}
class NoticePage extends StatelessWidget{const NoticePage({super.key});@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('알림')),body:const Center(child:Text('새 알림이 없습니다.')));}
class MyPage extends ConsumerWidget{const MyPage({super.key});@override Widget build(BuildContext context,WidgetRef ref)=>Scaffold(appBar:AppBar(title:const Text('마이페이지')),body:ListView(children:[const ListTile(leading:Icon(Icons.dark_mode_outlined),title:Text('시스템 다크 모드 사용')),ListTile(leading:const Icon(Icons.logout),title:const Text('로그아웃'),onTap:(){secureStorage.delete(key:'token');ref.read(authProvider.notifier).logout();})]));}
