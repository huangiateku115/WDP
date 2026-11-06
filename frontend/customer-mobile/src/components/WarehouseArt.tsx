import Svg,{Rect,Path,Circle,Line} from 'react-native-svg';
import {View} from 'react-native';
import {colors} from '../theme/tokens';

// Original vector artwork, bundled as native SVG. No external photo/asset URLs.
export function WarehouseArt({variant='south',height=154}:{variant?:'south'|'east'|'airport';height?:number}){
  const accent=variant==='east'?colors.orange:variant==='airport'?'#86a99a':colors.primaryContainer;
  return <View accessible accessibilityRole="image" accessibilityLabel="Minh họa không gian kho VaultSpace" style={{height,backgroundColor:colors.mint,borderRadius:14,overflow:'hidden'}}><Svg width="100%" height="100%" viewBox="0 0 360 180">
    <Rect width="360" height="180" fill="#dceee3"/><Circle cx="305" cy="35" r="23" fill="#fff1d7"/>
    <Path d="M0 128 L360 110 L360 180 L0 180Z" fill="#c8ded0"/><Path d="M25 143 L303 115 L354 147 L79 178Z" fill="#afc8b8"/>
    <Path d="M43 65 L231 41 L316 73 L126 99Z" fill={accent}/><Path d="M43 65 L126 99 L126 153 L43 118Z" fill="#326f52"/><Path d="M126 99 L316 73 L316 128 L126 153Z" fill="#f6fbf7"/>
    <Path d="M42 64 L231 39 L319 72 L126 101Z" fill="none" stroke="#0b5734" strokeWidth="3"/>
    {[0,1,2].map(i=><Path key={i} d={`M${145+i*52} ${102-i*7} l35 -5 v39 l-35 5Z`} fill={i===1?'#e48739':'#91b49e'} stroke="#5f8b71" strokeWidth="1.5"/>)}
    {[0,1,2,3].map(i=><Line key={i} x1="150" y1={111+i*7} x2="172" y2={108+i*7} stroke="#69917a" strokeWidth="1"/>)}
    <Path d="M62 85 l35 14 v31 l-35 -14Z" fill="#bcd8c7"/><Path d="M67 94 l24 10 M67 103 l24 10" stroke="#5f8b71" strokeWidth="2"/>
    <Rect x="261" y="132" width="20" height="17" rx="2" fill="#e99b54"/><Path d="M261 137h20 M271 132v17" stroke="#bd7637"/>
    <Circle cx="28" cy="132" r="13" fill="#629375"/><Path d="M28 130v30" stroke="#276341" strokeWidth="3"/>
    <Path d="M322 160l20 -2 M297 164l14 -2" stroke="#f7fbf8" strokeWidth="3"/>
  </Svg></View>;
}
