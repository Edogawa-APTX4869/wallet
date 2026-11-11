package com.alqubaiti.wallet;

import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebBackForwardList;
import android.webkit.WebHistoryItem;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

/**
 * Native Android host for Wallet.
 *
 * Responsibilities:
 * 1. Injects runtime mobile UX & CSS overrides on every WebView page load so that:
 *    - Widget swipe pagination dots are always ultra-compact (5px) and auto-hide until touched,
 *      never inflated to 48x48px circles by coarse-pointer touch-target rules.
 *    - Secondary/overlay routes (/new, /accounts/[id], /rules, /piggy-banks, /categories,
 *      /tags, /settings) and active modal/drawer/sheet/speed-dial layers hide the mobile
 *      bottom navigation bar so they cleanly overlay the main view.
 * 2. Owns the Android hardware back button / edge back-swipe gesture via OnBackPressedDispatcher:
 *    - Priority 1: If any modal, drawer, sheet, speed-dial, or nested detail layer is open,
 *      dismiss that layer and stay in the app.
 *    - Priority 2: If the mobile bottom navigation bar is visible on screen (main tab views:
 *      /, /accounts, /transactions, /reports, /budgets), ANY back swipe quits/minimizes the
 *      program (moveTaskToBack(true)) instead of going to the previously opened page.
 *    - Priority 3: If on an overlay/sub-page where the bottom navigation bar is hidden,
 *      navigate back to the main view (never backing into the local Capacitor bootstrap shell).
 */
public class MainActivity extends BridgeActivity {

  private static final String[] MAIN_TAB_PATHS = {
    "/", "/accounts", "/transactions", "/reports", "/budgets"
  };

  private static final String INJECT_RUNTIME_UX_JS =
    "(function(){" +
    "try{" +
    "if(!document.getElementById('wallet-apk-runtime-style')){" +
    "var st=document.createElement('style');" +
    "st.id='wallet-apk-runtime-style';" +
    "st.textContent=" +
    "'.swipeable-card{touch-action:pan-y!important;user-select:none!important;-webkit-user-select:none!important;overflow:hidden!important;}'+" +
    "'@keyframes wallet-swipe-enter-next{0%{opacity:0.15;transform:translate3d(44px,0,0) scale(0.985);filter:blur(2.5px);}100%{opacity:1;transform:translate3d(0,0,0) scale(1);filter:blur(0px);}}'+" +
    "'@keyframes wallet-swipe-enter-prev{0%{opacity:0.15;transform:translate3d(-44px,0,0) scale(0.985);filter:blur(2.5px);}100%{opacity:1;transform:translate3d(0,0,0) scale(1);filter:blur(0px);}}'+" +
    "'.swipeable-card.wallet-anim-next>*,.animate-swipe-next{animation:wallet-swipe-enter-next 320ms cubic-bezier(0.22,1,0.36,1) both!important;will-change:transform,opacity,filter!important;}'+" +
    "'.swipeable-card.wallet-anim-prev>*,.animate-swipe-prev{animation:wallet-swipe-enter-prev 320ms cubic-bezier(0.22,1,0.36,1) both!important;will-change:transform,opacity,filter!important;}'+" +
    "'[aria-label=\"View pagination\"]{display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;padding:2px 0!important;margin:2px 0 0 0!important;min-height:0!important;height:10px!important;opacity:0!important;pointer-events:none!important;transition:opacity 0.25s ease!important;}'+" +
    "'[aria-label=\"View pagination\"].wallet-dots-visible{opacity:0.9!important;}'+" +
    "'[aria-label=\"View pagination\"] button,[aria-label=\"View pagination\"] [role=\"tab\"]{min-width:0!important;min-height:0!important;width:5px!important;height:5px!important;padding:0!important;margin:0!important;border-radius:9999px!important;flex:0 0 auto!important;}'+" +
    "'[aria-label=\"View pagination\"] button[aria-selected=\"true\"],[aria-label=\"View pagination\"] [role=\"tab\"][aria-selected=\"true\"]{width:14px!important;height:5px!important;}'+" +
    "'[aria-label=\"View pagination\"] button[data-pagination-dot=\"true\"]{width:auto!important;height:auto!important;padding:2px!important;background:transparent!important;box-shadow:none!important;}'+" +
    "'[aria-label=\"View pagination\"] button[data-pagination-dot=\"true\"]>span{min-width:0!important;min-height:0!important;width:5px!important;height:5px!important;border-radius:9999px!important;display:block!important;}'+" +
    "'[aria-label=\"View pagination\"] button[data-pagination-dot=\"true\"][aria-selected=\"true\"]>span{width:14px!important;height:5px!important;}'+" +
    "'body[data-wallet-overlay=\"true\"] nav[aria-label=\"Main\"].fixed,body[data-wallet-overlay=\"true\"] [data-mobile-bottom-nav=\"true\"]{display:none!important;}'+" +
    "'body[data-wallet-hide-fab=\"true\"] button[aria-label=\"Add transaction\"],body[data-wallet-hide-fab=\"true\"] button[aria-label=\"Close quick actions\"]{display:none!important;}'+" +
    "'body[data-wallet-hide-chat=\"true\"] button[aria-label=\"Ask AI Assistant\"]{display:none!important;}'+" +
    "'body[data-wallet-fullbleed=\"true\"] header.sticky.top-0{display:none!important;}';" +
    "(document.head||document.documentElement).appendChild(st);" +
    "}" +
    "if(!window.__walletRuntimeInstalled){" +
    "window.__walletRuntimeInstalled=true;" +
    "var dotTimers=new WeakMap();" +
    "function revealWidgetDots(target){" +
    "if(!target||!target.closest)return;" +
    "var card=target.closest('.swipeable-card');" +
    "var dots=card&&card.parentElement?card.parentElement.querySelector('[aria-label=\"View pagination\"]'):target.closest('[aria-label=\"View pagination\"]');" +
    "if(!dots)return;" +
    "dots.classList.add('wallet-dots-visible');" +
    "var prev=dotTimers.get(dots);" +
    "if(prev)clearTimeout(prev);" +
    "dotTimers.set(dots,setTimeout(function(){dots.classList.remove('wallet-dots-visible');},1600));" +
    "}" +
    "var suppressClickUntil=0;" +
    "document.addEventListener('click',function(e){if(e.target&&e.target.closest&&e.target.closest('[aria-label=\"View pagination\"]'))return;if(Date.now()<suppressClickUntil){suppressClickUntil=0;e.preventDefault();e.stopPropagation();}},true);" +
    "function playSwipeAnim(card,dir){" +
    "if(!card)return;" +
    "var cls=dir==='next'?'wallet-anim-next':'wallet-anim-prev';" +
    "function apply(){var ch=card.firstElementChild||card;card.classList.remove('wallet-anim-next','wallet-anim-prev');ch.style.animation='none';void ch.offsetWidth;ch.style.animation='';card.classList.add(cls);}" +
    "apply();" +
    "var obs=new MutationObserver(function(){apply();obs.disconnect();});" +
    "obs.observe(card,{childList:true,subtree:true,characterData:true});" +
    "setTimeout(function(){obs.disconnect();},420);" +
    "setTimeout(function(){card.classList.remove('wallet-anim-next','wallet-anim-prev');},520);" +
    "}" +
    "function clearCardDragStyles(card){" +
    "if(!card)return;" +
    "card.classList.remove('is-dragging');" +
    "card.style.removeProperty('--swipe-x');" +
    "card.style.removeProperty('--swipe-scale');" +
    "card.style.removeProperty('--swipe-opacity');" +
    "card.style.removeProperty('--swipe-blur');" +
    "card.style.removeProperty('--swipe-content-blur');" +
    "}" +
    "function interceptLegacyTouchPointer(e){" +
    "if(e.pointerType!=='touch')return;" +
    "var t=e.target;" +
    "if(!t||!t.closest)return;" +
    "if(t.closest('input,select,textarea,[data-no-swipe],[data-pagination-dot],[aria-label=\"View pagination\"]'))return;" +
    "var card=t.closest('.swipeable-card:not([data-swipe-v2])');" +
    "if(card){revealWidgetDots(card);e.stopPropagation();}" +
    "}" +
    "document.addEventListener('pointerdown',function(e){revealWidgetDots(e.target);interceptLegacyTouchPointer(e);},true);" +
    "document.addEventListener('pointermove',interceptLegacyTouchPointer,true);" +
    "document.addEventListener('pointerup',interceptLegacyTouchPointer,true);" +
    "document.addEventListener('pointercancel',interceptLegacyTouchPointer,true);" +
    "var swipeState=null;" +
    "document.addEventListener('touchstart',function(e){" +
    "revealWidgetDots(e.target);" +
    "if(e.touches.length!==1)return;" +
    "var t=e.target;" +
    "if(!t||!t.closest)return;" +
    "if(t.closest('input,select,textarea,[data-no-swipe],[data-pagination-dot],[aria-label=\"View pagination\"]'))return;" +
    "var card=t.closest('.swipeable-card:not([data-swipe-v2])');" +
    "if(!card||!card.parentElement)return;" +
    "var dots=card.parentElement.querySelector('[aria-label=\"View pagination\"]');" +
    "var tabs=dots?dots.querySelectorAll('[role=\"tab\"]'):null;" +
    "if(!tabs||tabs.length<=1)return;" +
    "var activeIdx=0;" +
    "for(var i=0;i<tabs.length;i++){if(tabs[i].getAttribute('aria-selected')==='true'){activeIdx=i;break;}}" +
    "var touch=e.touches[0];" +
    "var rect=card.getBoundingClientRect();" +
    "swipeState={card:card,tabs:tabs,activeIdx:activeIdx,total:tabs.length,startX:touch.clientX,startY:touch.clientY,lastX:touch.clientX,lastTime:performance.now(),velocityX:0,width:(rect&&rect.width)||320,locked:null};" +
    "},{passive:true,capture:true});" +
    "document.addEventListener('touchmove',function(e){" +
    "revealWidgetDots(e.target);" +
    "if(!swipeState||e.touches.length!==1)return;" +
    "var touch=e.touches[0];" +
    "var dx=touch.clientX-swipeState.startX;" +
    "var dy=touch.clientY-swipeState.startY;" +
    "if(!swipeState.locked){" +
    "if(Math.abs(dx)<7&&Math.abs(dy)<7)return;" +
    "swipeState.locked=Math.abs(dx)>=Math.abs(dy)?'x':'y';" +
    "if(swipeState.locked==='y'){swipeState=null;return;}" +
    "}" +
    "if(swipeState.locked!=='x')return;" +
    "if(e.cancelable)e.preventDefault();" +
    "var now=performance.now();" +
    "var dt=Math.max(1,now-swipeState.lastTime);" +
    "var instVel=(touch.clientX-swipeState.lastX)/dt;" +
    "swipeState.velocityX=swipeState.velocityX*0.4+instVel*0.6;" +
    "swipeState.lastX=touch.clientX;" +
    "swipeState.lastTime=now;" +
    "var canPrev=swipeState.activeIdx>0;" +
    "var canNext=swipeState.activeIdx<swipeState.total-1;" +
    "var effDx=dx;" +
    "if((dx>0&&!canPrev)||(dx<0&&!canNext)){" +
    "var sgn=dx<0?-1:1;var abs=Math.abs(dx);" +
    "effDx=sgn*Math.min(abs*0.35,85*(Math.log(1+abs/40)/Math.LN10));" +
    "}" +
    "var prog=Math.min(1,Math.abs(effDx)/(swipeState.width*0.65));" +
    "var c=swipeState.card;" +
    "c.classList.remove('wallet-anim-next','wallet-anim-prev','is-rubber-banding');" +
    "c.classList.add('is-dragging');" +
    "c.style.setProperty('--swipe-x',effDx.toFixed(1)+'px');" +
    "c.style.setProperty('--swipe-scale',(1-prog*0.03).toFixed(3));" +
    "c.style.setProperty('--swipe-opacity',(1-prog*0.15).toFixed(3));" +
    "c.style.setProperty('--swipe-blur',(prog*5).toFixed(1)+'px');" +
    "c.style.setProperty('--swipe-content-blur',(prog*1.8).toFixed(1)+'px');" +
    "},{passive:false,capture:true});" +
    "function finishLegacyTouch(e){" +
    "if(!swipeState)return;" +
    "var s=swipeState;swipeState=null;" +
    "if(s.locked!=='x'){clearCardDragStyles(s.card);return;}" +
    "var endX=(e.changedTouches&&e.changedTouches[0])?e.changedTouches[0].clientX:s.lastX;" +
    "var dx=endX-s.startX;" +
    "var absDx=Math.abs(dx);" +
    "var ratio=absDx/Math.max(200,s.width);" +
    "var absVel=Math.abs(s.velocityX);" +
    "var meets=ratio>=0.16||absDx>=52||(absDx>=16&&absVel>0.32);" +
    "var canPrev=s.activeIdx>0;" +
    "var canNext=s.activeIdx<s.total-1;" +
    "clearCardDragStyles(s.card);" +
    "if(meets&&dx<0&&canNext){" +
    "playSwipeAnim(s.card,'next');" +
    "s.tabs[s.activeIdx+1].click();" +
    "}else if(meets&&dx>0&&canPrev){" +
    "playSwipeAnim(s.card,'prev');" +
    "s.tabs[s.activeIdx-1].click();" +
    "}else{" +
    "s.card.classList.add('is-rubber-banding');" +
    "setTimeout(function(){s.card.classList.remove('is-rubber-banding');},260);" +
    "}" +
    "if(absDx>=8)suppressClickUntil=Date.now()+180;" +
    "}" +
    "document.addEventListener('touchend',finishLegacyTouch,{passive:true,capture:true});" +
    "document.addEventListener('touchcancel',finishLegacyTouch,{passive:true,capture:true});" +
    "function isMainPath(p){" +
    "var c=(p||'/').split('?')[0].replace(/\\/+$/,'')||'/';" +
    "return c==='/'||c==='/accounts'||c==='/transactions'||c==='/reports'||c==='/budgets';" +
    "}" +
    "function syncOverlayState(){" +
    "if(!document.body)return;" +
    "var p=window.location.pathname||'/';" +
    "var clean=p.split('?')[0].replace(/\\/+$/,'')||'/';" +
    "var mainRoute=isMainPath(clean);" +
    "var isNew=clean==='/new'||clean.indexOf('/new/')===0;" +
    "var hasModal=!!document.querySelector('[role=\"dialog\"][aria-modal=\"true\"],#mobile-nav-drawer');" +
    "var hasFab=!!document.querySelector('[data-testid=\"fab-backdrop\"]');" +
    "var hasDockExp=!!document.querySelector('[aria-label=\"Collapse filter dock\"]');" +
    "var overlay=!mainRoute||hasModal||hasFab||hasDockExp;" +
    "if(overlay)document.body.setAttribute('data-wallet-overlay','true');" +
    "else document.body.removeAttribute('data-wallet-overlay');" +
    "if(isNew)document.body.setAttribute('data-wallet-fullbleed','true');" +
    "else document.body.removeAttribute('data-wallet-fullbleed');" +
    "if(!mainRoute||hasModal)document.body.setAttribute('data-wallet-hide-fab','true');" +
    "else document.body.removeAttribute('data-wallet-hide-fab');" +
    "if(!mainRoute||hasModal||hasFab)document.body.setAttribute('data-wallet-hide-chat','true');" +
    "else document.body.removeAttribute('data-wallet-hide-chat');" +
    "var hdr=document.querySelector('header.sticky.top-0');" +
    "if(hdr){" +
    "var nativeBack=hdr.querySelector('button[aria-label=\"Go back\"]');" +
    "var injectedBack=hdr.querySelector('#wallet-injected-back');" +
    "var menuBtn=hdr.querySelector('button[aria-label=\"Open navigation menu\"]');" +
    "if(!mainRoute&&!isNew&&!nativeBack){" +
    "if(!injectedBack&&menuBtn&&menuBtn.parentElement){" +
    "var b=document.createElement('button');" +
    "b.type='button';" +
    "b.id='wallet-injected-back';" +
    "b.setAttribute('aria-label','Go back');" +
    "b.className=menuBtn.className;" +
    "b.innerHTML='<svg class=\"size-5\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m12 19-7-7 7-7\"/><path d=\"M19 12H5\"/></svg>';" +
    "b.onclick=function(){if(window.history.length>1)window.history.back();else window.location.replace('/');};" +
    "menuBtn.parentElement.insertBefore(b,menuBtn);" +
    "menuBtn.style.display='none';" +
    "}" +
    "}else if(injectedBack){" +
    "if(menuBtn)menuBtn.style.display='';" +
    "injectedBack.remove();" +
    "}" +
    "}" +
    "}" +
    "window.__walletSyncOverlay=syncOverlayState;" +
    "var origPush=history.pushState;history.pushState=function(){var r=origPush.apply(this,arguments);setTimeout(syncOverlayState,0);return r;};" +
    "var origRep=history.replaceState;history.replaceState=function(){var r=origRep.apply(this,arguments);setTimeout(syncOverlayState,0);return r;};" +
    "window.addEventListener('popstate',function(){setTimeout(syncOverlayState,0);});" +
    "var mo=new MutationObserver(function(){syncOverlayState();});" +
    "mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-modal','data-nav-hidden']});" +
    "syncOverlayState();" +
    "}else if(typeof window.__walletSyncOverlay==='function'){" +
    "window.__walletSyncOverlay();" +
    "}" +
    "}catch(e){}" +
    "})()";

  private static final String JS_DECIDE =
    "(function(){" +
    "try{" +
    "if(typeof window.__walletBack==='function'){" +
    "var r=String(window.__walletBack());" +
    "if(r==='handled'||r==='exit'||r==='back')return r;" +
    "}" +
    "var ev=new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true});" +
    "var notCancelled=window.dispatchEvent(ev);" +
    "if(!notCancelled||ev.defaultPrevented)return 'handled';" +
    "var backCalc=document.querySelector('button[aria-label=\"Back to calculator\"]');" +
    "if(backCalc){backCalc.click();return 'handled';}" +
    "var btns=document.querySelectorAll('button');" +
    "for(var b=0;b<btns.length;b++){" +
    "var txt=(btns[b].textContent||'').trim();" +
    "if(txt.indexOf('Back to Calculator')!==-1&&btns[b].offsetParent!==null){btns[b].click();return 'handled';}" +
    "}" +
    "var closeSelectors=['[data-testid=\"drawer-backdrop\"]','[data-testid=\"fab-backdrop\"]','button[aria-label=\"Close notifications\"]','button[aria-label=\"Close builder\"]','button[aria-label=\"Close test results\"]','[role=\"dialog\"][aria-modal=\"true\"] button[aria-label=\"Close\"]','[aria-label=\"Collapse filter dock\"]'];" +
    "for(var i=0;i<closeSelectors.length;i++){" +
    "var el=document.querySelector(closeSelectors[i]);" +
    "if(el){el.click();return 'handled';}" +
    "}" +
    "var p=(window.location.pathname||'/').split('?')[0].replace(/\\/+$/,'')||'/';" +
    "var isMain=(p==='/'||p==='/accounts'||p==='/transactions'||p==='/reports'||p==='/budgets');" +
    "var overlayAttr=document.body&&document.body.getAttribute('data-wallet-overlay')==='true';" +
    "if(isMain&&!overlayAttr)return 'exit';" +
    "return 'back';" +
    "}catch(e){return '';}" +
    "})()";

  private boolean backInFlight = false;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    if (getBridge() != null) {
      getBridge().addWebViewListener(new WebViewListener() {
        @Override
        public void onPageCommitVisible(WebView view, String url) {
          injectRuntimeEnhancements(view);
        }

        @Override
        public void onPageLoaded(WebView webView) {
          injectRuntimeEnhancements(webView);
        }
      });
    }

    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        handleBack();
      }
    });
  }

  private void injectRuntimeEnhancements(WebView webView) {
    if (webView == null) return;
    webView.evaluateJavascript(INJECT_RUNTIME_UX_JS, null);
  }

  private void handleBack() {
    final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
    if (webView == null) {
      moveTaskToBack(true);
      return;
    }
    if (backInFlight) return;
    backInFlight = true;

    webView.evaluateJavascript(JS_DECIDE, value -> {
      backInFlight = false;
      String decision = value == null ? "" : value.replace("\"", "").trim();
      switch (decision) {
        case "handled":
          injectRuntimeEnhancements(webView);
          return;
        case "exit":
          moveTaskToBack(true);
          return;
        case "back":
          navigateBackFromOverlayRoute(webView);
          return;
        default:
          fallbackByUrl(webView);
      }
    });
  }

  private void navigateBackFromOverlayRoute(WebView webView) {
    if (canGoBackToWalletPage(webView)) {
      webView.goBack();
    } else {
      // If there is no prior Wallet page in WebView history (e.g. previous item is the local
      // Capacitor launcher shell), navigate cleanly to the Home screen instead of the shell.
      webView.evaluateJavascript("window.location.replace('/');", null);
    }
  }

  private boolean canGoBackToWalletPage(WebView webView) {
    if (!webView.canGoBack()) return false;
    try {
      WebBackForwardList list = webView.copyBackForwardList();
      int prevIdx = list.getCurrentIndex() - 1;
      if (prevIdx < 0) return false;
      WebHistoryItem prevItem = list.getItemAtIndex(prevIdx);
      if (prevItem == null) return false;
      String prevUrl = prevItem.getUrl();
      if (prevUrl == null) return false;
      Uri uri = Uri.parse(prevUrl);
      String scheme = uri.getScheme();
      String host = uri.getHost();
      if ("file".equalsIgnoreCase(scheme)) return false;
      if ("localhost".equalsIgnoreCase(host)) return false;
      return true;
    } catch (Exception e) {
      return webView.canGoBack();
    }
  }

  private void fallbackByUrl(WebView webView) {
    String url = webView.getUrl();
    if (url == null || isMainTab(url)) {
      moveTaskToBack(true);
    } else {
      navigateBackFromOverlayRoute(webView);
    }
  }

  private static boolean isMainTab(String url) {
    try {
      Uri uri = Uri.parse(url);
      String scheme = uri.getScheme();
      if (scheme == null || "file".equals(scheme)) return true;
      String host = uri.getHost();
      if ("localhost".equals(host)) return true;
      String path = uri.getPath();
      if (path == null || path.isEmpty()) path = "/";
      while (path.length() > 1 && path.endsWith("/")) path = path.substring(0, path.length() - 1);
      for (String p : MAIN_TAB_PATHS) {
        if (p.equals(path)) return true;
      }
      return false;
    } catch (Exception e) {
      return true;
    }
  }
}
