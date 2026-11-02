jest.mock('react-native-safe-area-context',()=>require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons/Ionicons',()=>({__esModule:true,default:()=>null}));
jest.mock('react-native-svg',()=>{
  const React=require('react');const {View}=require('react-native');
  const Shape=({children}:any)=>React.createElement(View,null,children);
  return {__esModule:true,default:Shape,Svg:Shape,Rect:Shape,Path:Shape,Circle:Shape,Line:Shape};
});
