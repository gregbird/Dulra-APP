let watermarkResolve: ((value: string | null) => void) | null = null;
let webViewRef: { postMessage: (msg: string) => void } | null = null;

export function setWatermarkWebView(ref: { postMessage: (msg: string) => void } | null) {
  webViewRef = ref;
}

export function handleWatermarkResult(base64: string | null) {
  if (watermarkResolve) {
    watermarkResolve(base64);
    watermarkResolve = null;
  }
}

interface WatermarkParams {
  imageBase64: string;
  dateTime: Date;
  latitude: number | null;
  longitude: number | null;
  projectName: string;
}

function formatCoord(lat: number | null, lng: number | null): string {
  if (lat === null || lng === null) return "No GPS";
  const latDir = lat >= 0 ? "N" : "S";
  const lngDir = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(5)}${latDir}, ${Math.abs(lng).toFixed(5)}${lngDir}`;
}

function formatDate(date: Date): string {
  // Web's overlay uses "1 Apr 2026 at 07:00" — keep mobile's burnt-in
  // watermark in the same shape so the two render identically when web
  // hides the UI overlay and falls back to whatever's already on the file.
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} at ${time}`;
}

export function addWatermark(params: WatermarkParams): Promise<string | null> {
  if (!webViewRef) return Promise.resolve(null);

  // Single bar rule (matches web): "1 Apr 2026 at 07:00 | 41.00921N, 29.07850E"
  const line1 = `${formatDate(params.dateTime)} | ${formatCoord(params.latitude, params.longitude)}`;
  const line2 = params.projectName;

  return new Promise((resolve) => {
    watermarkResolve = resolve;
    setTimeout(() => {
      if (watermarkResolve === resolve) {
        watermarkResolve = null;
        resolve(null);
      }
    }, 15000);

    webViewRef!.postMessage(JSON.stringify({
      type: "watermark",
      imageBase64: params.imageBase64,
      line1,
      line2,
    }));
  });
}

export const WATERMARK_HTML = `
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#000}</style></head>
<body><canvas id="c"></canvas>
<script>
window.addEventListener('message', function(e) {
  try {
    var d = JSON.parse(e.data);
    if (d.type !== 'watermark') return;
    var img = new Image();
    img.onload = function() {
      var c = document.getElementById('c');
      c.width = img.width;
      c.height = img.height;
      var ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      var bh = Math.max(img.height * 0.06, 60);
      var fs = Math.max(bh * 0.35, 16);
      var by = img.height - bh;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, by, img.width, bh);
      ctx.fillStyle = '#ffffff';
      ctx.font = fs + 'px Arial, sans-serif';
      var pad = bh * 0.15;
      ctx.fillText(d.line1, pad, by + fs + pad);
      ctx.fillText(d.line2, pad, by + fs * 2 + pad * 1.5);
      var result = c.toDataURL('image/jpeg', 0.85);
      var base64 = result.split(',')[1];
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'watermark_result',base64:base64}));
    };
    img.onerror = function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'watermark_result',base64:null}));
    };
    img.src = 'data:image/jpeg;base64,' + d.imageBase64;
  } catch(err) {
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'watermark_result',base64:null}));
  }
});
</script></body></html>
`;
