import {Platform} from 'react-native';

export const colors={
  primary:'#005f3a',primaryContainer:'#18794e',mint:'#e7f8ed',background:'#ecfef2',
  card:'#ffffff',text:'#101e18',muted:'#52665b',line:'#d6e7dc',orange:'#e97d29',
  orangeTint:'#fff0df',orangeText:'#844700',danger:'#b42318',dangerTint:'#fff0ed',
  inactive:'#607268',soft:'#f4faf6',white:'#ffffff',deep:'#003e28',
  surface:'#e1f2e7',surfaceHigh:'#dbece1',inverse:'#25342c',inverseText:'#e4f5ea',amber:'#ffddb8',
} as const;
export const spacing={xs:4,sm:8,md:12,lg:16,page:20,xl:24,xxl:32,hero:40} as const;
export const radius={sm:8,md:12,lg:18,pill:999} as const;
export const fonts={regular:'Inter_400Regular',medium:'Inter_500Medium',semibold:'Inter_600SemiBold',bold:'Inter_700Bold'} as const;
export const typography={
  display:{fontFamily:fonts.bold,fontSize:32,lineHeight:40,letterSpacing:-.7},
  title:{fontFamily:fonts.bold,fontSize:26,lineHeight:34,letterSpacing:-.4},
  heading:{fontFamily:fonts.semibold,fontSize:22,lineHeight:28},
  card:{fontFamily:fonts.semibold,fontSize:18,lineHeight:25},
  body:{fontFamily:fonts.regular,fontSize:14,lineHeight:21},
  medium:{fontFamily:fonts.medium,fontSize:14,lineHeight:21},
  label:{fontFamily:fonts.semibold,fontSize:12,lineHeight:18},
  caption:{fontFamily:fonts.regular,fontSize:11,lineHeight:17},
} as const;
export const elevation=Platform.select({
  ios:{shadowColor:colors.deep,shadowOpacity:.08,shadowRadius:8,shadowOffset:{width:0,height:3}},
  android:{elevation:2},web:{boxShadow:'0 3px 12px rgba(16, 61, 43, 0.07)'},default:{},
});
export const navigationTheme={dark:false,colors:{primary:colors.primary,background:colors.background,card:colors.card,text:colors.text,border:colors.line,notification:colors.orange},fonts:{regular:{fontFamily:fonts.regular,fontWeight:'400' as const},medium:{fontFamily:fonts.medium,fontWeight:'500' as const},bold:{fontFamily:fonts.bold,fontWeight:'700' as const},heavy:{fontFamily:fonts.bold,fontWeight:'700' as const}}};
