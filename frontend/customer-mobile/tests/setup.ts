// RNTL 14 exposes host nodes only. Record FlatList props while rendering the
// actual native list so its data and use of virtualization remain testable.
jest.mock('react-native', () => {
  const native = jest.requireActual<typeof import('react-native')>('react-native');
  const React = jest.requireActual<typeof import('react')>('react');
  const FlatList = jest.fn((props: import('react-native').FlatListProps<unknown>) =>
    React.createElement(native.FlatList, props));
  return Object.create(native, {FlatList: {value: FlatList, enumerable: true}});
});

jest.mock('react-native-safe-area-context',()=>require('react-native-safe-area-context/jest/mock').default);
jest.mock('@expo/vector-icons/Ionicons',()=>({__esModule:true,default:()=>null}));
jest.mock('react-native-svg',()=>{
  const React=require('react');const {View}=require('react-native');
  const Shape=({children}:any)=>React.createElement(View,null,children);
  return {__esModule:true,default:Shape,Svg:Shape,Rect:Shape,Path:Shape,Circle:Shape,Line:Shape};
});

// Transport tests install Axios adapters. Use an explicit non-routable API base,
// including on the iOS Jest preset where no development host is inferred.
process.env.EXPO_PUBLIC_API_BASE_URL='https://fixture.invalid/api/v1';
