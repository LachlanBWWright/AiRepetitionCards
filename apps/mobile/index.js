import "./global.css";
import { registerRootComponent } from "expo";
import App from "./App";
import { installNativePkceCrypto } from "./src/storage/auth/native-pkce-crypto";

installNativePkceCrypto();
registerRootComponent(App);
