import { Platform } from 'react-native';
import NativeMapNative from './NativeMap.native';
import NativeMapWeb from './NativeMap.web';

const NativeMap = Platform.OS === 'web' ? NativeMapWeb : NativeMapNative;

export default NativeMap;

