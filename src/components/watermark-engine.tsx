import { useRef, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import WebView from "react-native-webview";
import { WATERMARK_HTML, setWatermarkWebView, handleWatermarkResult } from "@/lib/watermark";

export default function WatermarkEngine() {
  const webViewRef = useRef<WebView>(null);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === "watermark_result") {
        handleWatermarkResult(data.base64 ?? null);
      }
    } catch {
      handleWatermarkResult(null);
    }
  }, []);

  const onLoad = useCallback(() => {
    if (webViewRef.current) {
      setWatermarkWebView(webViewRef.current);
    }
  }, []);

  return (
    <View style={styles.hidden}>
      <WebView
        ref={webViewRef}
        source={{ html: WATERMARK_HTML }}
        onMessage={onMessage}
        onLoad={onLoad}
        javaScriptEnabled
        originWhitelist={["*"]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { width: 0, height: 0, overflow: "hidden", position: "absolute" },
});
