
<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta http-equiv="x-dns-prefetch-control" content="on">

  <meta name="description" content="Hi, Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL. Regards Vivek">
  <meta property="og:url" content="https://www.mql5.com/en/forum/367885">
  <meta property="og:title" content="Getting Contract Specification Session Start / End times using MQL">
  <meta property="og:description" content="Hi, Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL. Regards Vivek...">
      <meta property="og:image" content="https://www.mql5.com/en/forum/images/og/fb/367885">
      <meta property="og:image:secure_url" content="https://www.mql5.com/en/forum/images/og/fb/367885">
            <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@mql5com">
  <meta name="twitter:image" content="https://www.mql5.com/en/forum/images/og/fb/367885">
  <meta name="theme-color" content="#4a76b8">
  <meta name="format-detection" content="telephone=no">
  <meta name="msapplication-config" content="none">
  <meta name="referrer" content="no-referrer-when-downgrade">
  <meta property="qc:admins" content="36367170677651456375">
  <meta property="wb:webmaster" content="073d7690269bcd81">
  <link rel="shortcut icon" href="https://c.mql5.com/i/favicon4.ico">
  <link rel="dns-prefetch" href="https://c.mql5.com">
  <link href="https://c.mql5.com/styles/core.a642a7a2c66884681225fd5196b1424e.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/all.9b04041c43d820f8adc7f870ba0b5a01.css" type="text/css" rel="stylesheet" media="all">
  <link href="https://c.mql5.com/styles/forum.a0f3f648de6c9849d4a288603fc9849f.css" type="text/css" rel="stylesheet" media="all">
  <link href="/en/forum/rss" rel="alternate" type="application/rss+xml" title="MetaTrader 5 trading, automated systems and strategy testing forum">
  <link href="/en/forum/ea/rss" rel="alternate" type="application/rss+xml" title="Expert Advisors and Automated Trading - MetaTrader 5 trading, automated systems and strategy testing forum">
  <link rel="canonical" href="https://www.mql5.com/en/forum/367885">
  <title>Getting Contract Specification Session Start / End times using MQL - ROC (Rate of Change) - Expert Advisors and Automated Trading - MQL5 programming forum</title>



<script type="text/javascript">
  !function(){window.mqGlobal={};var t=!1,n=!1,e=[],o=[],i=[];function d(t){var n;for(n=0;n<t.length;n+=1)t[n]()}function c(){t||(t=!0,d(e),d(o),o=[],e=[])}function a(){c(),n||(n=!0,d(i),i=[])}if(mqGlobal.AddOnReady=function(n,i){t?n(document):i?e.push(n):o.push(n)},mqGlobal.AddOnLoad=function(t){n?t(document):i.push(t)},mqGlobal.AddOnActiveWindowChange=function(t){this._onvisibility||(this._onvisibility=[]),this._onvisibility[this._onvisibility.length]=t},document.addEventListener)document.addEventListener("DOMContentLoaded",c,!1),window.addEventListener("load",a,!1);else if(document.attachEvent&&(document.attachEvent("onreadystatechange",(function(){switch(document.readyState){case"interactive":c();break;case"complete":a()}})),window.attachEvent("onload",a),document.documentElement.doScroll&&window==window.top)){!function n(){if(!t&&document.body)try{document.documentElement.doScroll("left"),c()}catch(t){setTimeout(n,0)}}()}}();
  mqGlobal.CookieDomain = ".mql5.com";
  mqGlobal.Language = 'en';
  mqGlobal.IsMobile = false;
  mqGlobal.ClearRteStorage = function (e) { if (window.GStorage || (window.GStorage = globalStorage()), window.GStorage.supported) try { var o = e; window.GStorage.getItem("rte_autosave_uid", function (e, t) { t == o && (window.GStorage.removeItem("rte_autosave_text"), window.GStorage.removeItem("rte_autosave_date"), window.GStorage.removeItem("rte_autosave_uid")) }) } catch (e) { } };
</script>
  

    <script src="https://c.mql5.com/js/all.f8625696240796e75a49b2616f4c5894.js" type="text/javascript" defer="defer"></script>
  <script src="https://c.mql5.com/js/vendor.39da41eb444456418e5e53cc110d1b68.js" type="text/javascript" defer="defer"></script>


</head>

<body id="cover" class="cover">


  <nav class="head">
    <a href="https://www.mql5.com" class="head__logo" title="MQL5 - Language of trade strategies built-in the MetaTrader 5 client terminal"></a>
      <div class="head__content">
        <div class="main-menu" id="mainmenu">
          
                    <ul class="main-menu__top-level" id="menuTopLevel">
                    <li class="main-menu__selected"><a href="/en/forum" data-fz-event="MQL5+Menu+Forum">Forum</a></li>
                    <li><a href="/en/market" data-fz-event="MQL5+Menu+Market">Market</a></li>
                    <li><a href="/en/signals" data-fz-event="MQL5+Menu+Signals">Signals</a></li>
                    <li><a href="/en/job" data-fz-event="MQL5+Menu+Job">Freelance</a></li>
                    <li><a href="/en/vps" data-fz-event="MQL5+Menu+VPS">VPS</a></li>
                    <li><a href="/en/quotes/overview" data-fz-event="MQL5+Menu+Overview">Quotes</a></li>
                    <li><a href="https://www.metatrader.com" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+MetaTrader">MetaTrader</a></li>
                  </ul><ul class="main-menu__second-level" id="menuSecondLevel">
                    <li><a href="/en/articles" data-fz-event="MQL5+Menu+Articles"><img src="https://c.mql5.com/i/menu/icon-articles4.svg" alt="" width="16" height="16"/>Articles</a></li>
                    <li><a href="/en/code" data-fz-event="MQL5+Menu+CodeBase"><img src="https://c.mql5.com/i/menu/icon-code4.svg" alt="" width="16" height="16"/>CodeBase</a></li>
                    <li><a href="https://forge.mql5.io/?lang=en" target="_blank" rel="noopener" data-fz-event="MQL5+Menu+AlgoForge"><img src="https://c.mql5.com/i/menu/icon-algoforge4.svg" alt="" width="16" height="16"/>Algo Forge</a></li>
                    <li><a href="/en/docs" data-fz-event="MQL5+Menu+Docs"><img src="https://c.mql5.com/i/menu/icon-docs4.svg" alt="" width="16" height="16"/>Documentation</a></li>
                    <li><a href="/en/book" data-fz-event="MQL5+Menu+Book"><img src="https://c.mql5.com/i/menu/icon-book4.svg" alt="" width="16" height="16"/>AlgoBook</a></li>
                    <li><a href="/en/neurobook" data-fz-event="MQL5+Menu+Neurobook"><img src="https://c.mql5.com/i/menu/icon-neurobook4.svg" alt="" width="16" height="16"/>NeuroBook</a></li>
                    <li><a href="/en/economic-calendar" data-fz-event="MQL5+Menu+Economic+Calendar"><img src="https://c.mql5.com/i/menu/icon-economic-calendar4.svg" alt="" width="16" height="16"/>Calendar</a></li>
                    <li><a href="https://web.metatrader.app/terminal?mode=demo&lang=en" target="_blank" rel="nofollow noopener" data-fz-event="MQL5+Menu+Trading"><img src="https://c.mql5.com/i/menu/icon-trading4.svg" alt="" width="16" height="16"/>WebTerminal</a></li>
                    <li class="main-menu__mobile"><a href="/en/about">About</a></li>
                    <li class="main-menu__second-tools"><a rel="noopener" target="_blank" href="https://t.me/mql5dev" title="Follow us on socials for top articles and CodeBase updates" class="button-mt" data-vars-fz="Algo+Trading+Channel+Submenu"><img width="18" height="18" src="https://c.mql5.com/i/sidebar/tg.svg" alt="" loading="lazy">Algo Trading Channel</a></li>
                    </ul>
        </div>
          <div class="main-menu__active">
            <a id="mainMenuSelected" href="#">
              <span class="main-menu__primary">Forum</span><span class="main-menu__secondary">Sections</span>
            </a>
          </div>
<form action="https://www.mql5.com/en/search" onsubmit="return false;" autocomplete="off" id="headerSearchForm" class="header-search" method="post">
<button type="button" id="headerSearchButton" title="Search" class="header-search__button"></button><div class="header-search__input"><input name="keyword" type="text" enterkeyhint="search" title="Enter search text" placeholder="Search" id="headerSearchKeyword"/><label for="headerSearchKeyword" class="header-search__placeholder">Type <span>/</span> to search:  @user, $symbol, ...</label><button id="headerSearchSubmit" class="header-search__submit"></button></div><button type="button" id="headerSearchClean" title="Close" class="header-search__clean"></button></form>        <input class="blurHandler" id="mainMenuBlurHandler" type="checkbox">
      </div>
      <div class="head__toolbar" id="headerToolbar">
          <div class="container loginRegister">
            <nav>
              <ul id="loginRegisterButtons"><li><a class="login" title="Please sign in. OpenID supported" href="https://www.mql5.com/en/auth_login" rel="nofollow" data-fz-event="MQL5+Menu+Siginin">Log in</a></li><li><a class="registration en" title="Please register" href="https://www.mql5.com/en/auth_register" rel="nofollow" data-fz-event="MQL5+Menu+Register" onclick="window.fpush('MQL5+Button+Click');">Create an account</a></li></ul>
            </nav>
          </div>
        <div class="toggle-button" id="sidebarToggleButton">
          <i></i>
        </div>

        <div class="group-menu" id="groupMenu">


          <div class="container lang-menu-container">
            <div id="langMenuContainer" class="lang-menu">
              <input class="blurHandler" id="langmenuBlurHandler" type="checkbox">
              <nav>
                <ul class="lang-menu__list" id="langmenu">
                  <li class="lang-menu__list-item lang-menu__list-item_selected"><a href="/en/forum" aria-label="English (English)"><i class="icons-languages icons-languages_en"></i><span>English</span></a></li>
<li class="lang-menu__list-item"><a href="/ru/forum" aria-label="Русский (Russian)"><i class="icons-languages icons-languages_ru"></i><span>Русский</span></a></li>
<li class="lang-menu__list-item"><a href="/zh/forum" aria-label="中文 (Chinese)"><i class="icons-languages icons-languages_zh"></i><span>中文</span></a></li>
<li class="lang-menu__list-item"><a href="/es/forum" aria-label="Español (Spanish)"><i class="icons-languages icons-languages_es"></i><span>Español</span></a></li>
<li class="lang-menu__list-item"><a href="/pt/forum" aria-label="Português (Portuguese)"><i class="icons-languages icons-languages_pt"></i><span>Português</span></a></li>
<li class="lang-menu__list-item"><a href="/ja/forum" aria-label="日本語 (Japanese)"><i class="icons-languages icons-languages_ja"></i><span>日本語</span></a></li>
<li class="lang-menu__list-item"><a href="/de/forum" aria-label="Deutsch (German)"><i class="icons-languages icons-languages_de"></i><span>Deutsch</span></a></li>
<li class="lang-menu__list-item"><a href="/ko/forum" aria-label="한국어 (Korean)"><i class="icons-languages icons-languages_ko"></i><span>한국어</span></a></li>
<li class="lang-menu__list-item"><a href="/fr/forum" aria-label="Français (French)"><i class="icons-languages icons-languages_fr"></i><span>Français</span></a></li>
<li class="lang-menu__list-item"><a href="/it/forum" aria-label="Italiano (Italian)"><i class="icons-languages icons-languages_it"></i><span>Italiano</span></a></li>
<li class="lang-menu__list-item"><a href="/tr/forum" aria-label="Türkçe (Turkish)"><i class="icons-languages icons-languages_tr"></i><span>Türkçe</span></a></li>

                </ul>
              </nav>
            </div>
          </div>
        </div>
      </div>
  </nav>

<div id='bfogggabsofabcpxuzmgaibarmaxasdrj' class="r7pzo6pdelze088su g0j5459ml"></div>
  <article class="articles-content splashed">
    


<div class="top-band__topic">
  <h1 class="path title-min" id="forumTitle">Getting Contract Specification Session Start / End times using MQL</h1>
  <div style="clear: both;"></div>

  <div class="forum-topic__block-controls">
    <nav class="left-part">
      <div class="shortlinks">
        <a href="/en/forum" class="forum-root" title="Root"></a><a href="/en/forum/ea" class="forum-category" title="Category: Expert Advisors and Automated Trading"></a>
      </div>

      <div class="paginatorEx">
      </div>

    </nav>

      <div class="ui topic__buttons-area">
          <a class="button button_green button_with-icon" href="javascript:void(false);" onclick="if(window.registerLoginPopup){ window.registerLoginPopup.show(); }">
            <i class="icons-buttons icons-buttons_new-comment"></i>New comment
          </a>
      </div>
  </div>
</div>

<div class="topic" id="forumTopicComments">

      <div class="comment-box comments forum-topic__comments">
          <aside class="comment-side user">
<div class="frame"><div class="bg"><img src="https://c.mql5.com/avatar/avatar_na2.png" srcset="https://c.mql5.com/avatar/avatar_na2_big.png 2x" alt="AnkaSoftware" title="AnkaSoftware" data-user-login="AnkaSoftware" loading="lazy" width="60" height="60"></div></div><span title="Rating">157</span>
          </aside>
        <div class="text">
          <header>
            <span id="author_info_topic367885"
                  style="font-weight: bold;">
              <span>
                <a class="author" itemprop="url"  href="/en/users/ankasoftware">AnkaSoftware</a>
              </span>
            </span>

            <span
              class="comment__date"
              id="date_367885"
              data-date-create="2021.04.24 09:33"
              data-date-modify=""
              title="Created">
              <time datetime="2021-04-24T09:33Z" itemprop="datePublished" content="2021-04-24T09:33Z">2021.04.24 09:33</time>
            </span>



              &nbsp;
          </header>

            <div
              class="content"
              id="contenttopic367885">
              <p>Hi,</p> <p>&nbsp; &nbsp; Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL.</p> <p><br/></p> <p>Regards</p> <p><br/></p> <p>Vivek</p>
            </div>
              <div class="attach">
                <div id="cb_367885" class="attachBlock">
    <b>Files:</b>
  <div class="attach-block__list">
      <div class="attachItem">
          <a title="Download Snip_GbpJpy.PNG" href="https://c.mql5.com/3/354/Snip_GbpJpy.PNG"><i class="attach-icon attach-icon_PNG"></i>Snip_GbpJpy.PNG</a>
&nbsp;<span class="attachSize">24 kb</span>      </div>
  </div>
</div>

              </div>

          <div class="options">
            

          </div>
        </div>

      </div>

  <div class="forum-topic__comments">
    


  
<div class="comments" id="comments">
        <div class="comment-box" id="comment_22008077">

            <aside class="comment-side user">
              <div class="frame"><div class="bg"><img src="https://c.mql5.com/avatar/avatar_na2.png" srcset="https://c.mql5.com/avatar/avatar_na2_big.png 2x" loading="lazy" width="60" height="60"></div></div>

            </aside>

          <div class="text">
	          <header>
		          <span id="author_info_22008077"
		                style="font-weight: bold;">
			          <span>
				          <span class="removed_user">[Deleted]</span>
			          </span>
		          </span>
		          <span class="comment__date" id="date_22008077" data-date-create="2021.04.24 09:43" data-date-modify="" title="Created">
                <time datetime="2021-04-24T09:43Z" itemprop="datePublished" content="2021-04-24T09:43Z">2021.04.24 09:43</time>
		          </span>



<a class="permalink" title="Permanent link" href="/en/forum/367885#comment_22008077" rel="nofollow" onclick="return false;">#1</a>                &nbsp;
	          </header>

	          <div
		          class="content"
		          id="content22008077">
		          <div class="fquote"> <b><span style="color:rgb(66, 99, 156);">AnkaSoftware</span>:</b> Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL. </div> <p>EDIT2: The Session Information is available via the <a href="/en/docs/marketinformation/symbolinfosessionquote" target="_blank">SymbolInfoSessionQuote</a> / <a href="/en/docs/marketinformation/symbolinfosessiontrade" target="_blank">SymbolInfoSessionTrade</a> funtions.</p> <p>Most other details should be available via the <a href="/en/docs/constants/environment_state/marketinfoconstants" target="_blank">Symbol Properties</a> and the use of the <i>SymbolInfo</i> functions. </p> <p>EDIT3: There is also the <a href="/en/docs/marketinformation" target="_blank">Market Information</a> functions for other info.<br/></p>
	          </div>

		          <div>

<div class="extractor view" id="extractor22008077">
  <div class="extractorContent">
      <div class="image">
        <img src="https://c.mql5.com/36/47/documentation-on-mql5-constants__10.png" loading="lazy" width="120" height="63" alt="Documentation on MQL5: Constants, Enumerations and Structures / Environment State / Symbol Properties" title="Documentation on MQL5: Constants, Enumerations and Structures / Environment State / Symbol Properties">
      </div>

    <div style="margin-left: 130px">
      <a href="https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants" target="_blank" rel="noreferrer noopener nofollow">Documentation on MQL5: Constants, Enumerations and Structures / Environment State / Symbol Properties</a>

      <ul class="info"><li>www.mql5.com</li></ul>

      <div id="extractorDescription22008077">
        Symbol Properties - Environment State - Constants, Enumerations and Structures - MQL5 Reference - Reference on algorithmic/automated trading language for MetaTrader 5

      </div>
    </div>

    <div style="clear: both"></div>
  </div>


</div>
		          </div>


	          <div class="options">
		          

	          </div>
          </div>
        </div>
</div>

  </div>

  <div class="forum-topic__bottom">
    <div class="left-part">
      <div class="shortlinks">
        <a href="/en/forum" class="forum-root" title="Root"></a><a href="/en/forum/ea" class="forum-category" title="Category: Expert Advisors and Automated Trading"></a>
      </div>
    </div>
    <div class="right-part ui">
          <a class="button button_green button_with-icon" href="javascript:void(false);" onclick="if(window.registerLoginPopup){ window.registerLoginPopup.show(); }">
            <i class="icons-buttons icons-buttons_new-comment"></i>New comment
          </a>
    </div>
    <div class="clear-fix"></div>
  </div>
</div>





  



    


<div class="hidden" id="popupRegisterLogin">
  <div class="register-login-popup">
    <div class="register-login-popup__header">
      <img src="https://c.mql5.com/i/registerlandings/logo-2.png" srcset="https://c.mql5.com/i/registerlandings/logo-2_2x.png 2x" alt="MQL5 - Language of trade strategies built-in the MetaTrader 5 client terminal" loading="lazy" width="74" height="24" />
    </div>
    <div class="register-login-popup__content">
      <div class="register-login-popup__desc">
        <div class="register-login-popup__title">You are missing trading opportunities:</div>
        <ul>
<li>Free trading apps</li>
<li>Over 8,000 signals for copying</li>
<li>Economic news for exploring financial markets</li>
</ul>
      </div>
      <div class="register-login-popup__forms ui">
        <div class="register-login-popup__tabs" id="registerLoginPopupTabs">
          <span data-id="register" id="registerLoginPopupTab_register" class="register-login-popup__tab register-login-popup__tab_active">Registration</span>
          <span data-id="login" id="registerLoginPopupTab_login" class="register-login-popup__tab">Log in</span>
        </div>
        <div id="registerLoginPopupTabContent_register">
          <div class="ui auth-form__content">
    
  <script type='text/javascript'>/*<![CDATA[*/ if (!window.V) var V = []; /*]]>*/</script>
<script type='text/javascript'>/*<![CDATA[*/ if(! window.V) var V=[]; /*]]>*/</script>
<form method="POST" action="/en/auth_register_short" id="PopupRegisterquickRegisterForm" onsubmit="PopupRegisterquickRegistration.OnSubmit(this,&#39;en&#39;);if(Validate(this)) Ajax.form(this,{onready:PopupRegisterquickRegistration.OnSuccessPopup,onerror:PopupRegisterquickRegistration.OnError,onbeginrequest:PopupRegisterquickRegistration.DisableInputs,onendrequest:PopupRegisterquickRegistration.EnableInputs});return(false);" enctype = "multipart/form-data"><input type="hidden" name="__signature" value="7a52f1eba20c2fe8fdef1564e45d0359"/>
    <div class="auth-form__inputs">
      <input type="hidden" value="0" name="IsValidate" id="PopupRegisterIsValidate" />

      <!--[if lt IE 10]><div class="note">Login:</div><![endif]-->
      <div class="auth-form__box-input">
        <input type="text" id="PopupRegisterusername" name="username" class="input" maxlength="32" onchange="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.CheckUserName();}" onkeyup="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.ValidateUserName(this, 'Enter a valid login');}" placeholder="Login" title="May contain Latin letters, digits, dots, dashes,underscore characters. Cannot start or end with a dot. The allowed length is 3 to 32 characters." onfocus="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnFocus(this,'');}" onblur="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnBlur(this);}">
        <script type='text/javascript' id='validate_PopupRegisterusername'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['PopupRegisterusername',10,'You may use Latin characters, numbers, underscores and periods.',validate_username]);}); /*]]>*/</script>

        <label class="label" for="PopupRegisterusername">latin characters without spaces</label>
      </div>
      <!--[if lt IE 10]><div class="note">Your email:</div><![endif]-->
      <div class="auth-form__box-input">
        <input class="input" type="email" id="PopupRegisteremail" name="email" placeholder="Your email" title="Please enter the email (it may not exceed 256 characters). For example: john@example.com" onchange="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnChange(this);}" onfocus="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnFocus(this,'');}" onblur="if(window.PopupRegisterquickRegistration){PopupRegisterquickRegistration.OnBlur(this);}">
        <script type='text/javascript' id='validate_PopupRegisteremail'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['PopupRegisteremail',10,'Enter a valid email address',validate_email]);}); /*]]>*/</script>

        <label class="label" for="PopupRegisteremail">a password will be sent to this email</label>
      </div>
      <input name="PrefixId" type="hidden" value="Popup&#x2B;Register" />
    </div>
    <span id="PopupRegisterquickRegisterSubmit">
      <input type="submit" value="Register" id="PopupRegisterquickRegisterButton"  title="Sign up and receive an email with your password" class="button button_yellow"  />
    </span>
    <span id="PopupRegisterquickRegisterErrorMessage" class="quick-register-error-message field-validation-error" style="text-align: center; margin-top: 16px; display: none;">
      An error occurred
    </span>
</form>
    
</div>
<div class="auth-social">
  <ul class="auth-social-list" id="socialList">
    <li><a onclick="window.fpush({name: 'MQL5+Popup+Register+Google', unit: 'section', value: 'Forum'}); " href="https://www.mql5.com/en/auth_oauth2?provider=Google&amp;amp;return=popup&amp;amp;reg=1" class="auth-soc-button qa-google-button auth-soc-button_google" rel="nofollow">Log in With Google</a></li>
  </ul>
</div>
<div class="auth-block-agree">
  <p>
    You agree to <a target="_blank" href="/en/about/privacy">website policy</a> and <a target="_blank" href="/en/about/terms">terms of use</a>
  </p>
</div>


        </div>
        <div id="registerLoginPopupTabContent_login" class="hidden">
            <div class="auth-form__text">
    If you do not have an account, please <a href="https://www.mql5.com/en/auth_register" rel="nofollow" style="vertical-align: top">register</a>
  </div>
<div class="ui auth-form__content auth-form__content_login" id="loginFormWrapper">
    
  <div id="needCookies" class="need-cookies hidden">
    <div class="danger-box">
      <p>Allow the use of cookies to log in to the MQL5.com website.</p>
<p>Please enable the necessary setting in your browser, otherwise you will not be able to log in.</p>
    </div>
  </div>
<script type='text/javascript'>/*<![CDATA[*/ if(! window.V) var V=[]; /*]]>*/</script>
<form method="POST" action="/en/auth_login" id="loginForm" onsubmit="if(window.quickLogin){return window.quickLogin.onSubmit(this);}var result = Validate(this); if(result) { preventDoubleSubmit(this); } return result;"><input id="RedirectAfterLoginUrl" name="RedirectAfterLoginUrl" type="hidden" value="" /><input id="RegistrationUrl" name="RegistrationUrl" type="hidden" value="" /><input data-val="true" data-val-required="The ShowOpenId field is required." id="ShowOpenId" name="ShowOpenId" type="hidden" value="True" /><input id="TrackingSection" name="TrackingSection" type="hidden" value="Forum" />    <input name="ViewType" type="hidden" value="5" />
      <input name="PrefixId" type="hidden" value="Popup&#x2B;Login" />
    <!--[if lt IE 10]><div class="note">Your login:</div><![endif]-->
    <div class="auth-form__box-input">
      <input class="input qa-login" id="Login" name="Login" onchange="if(window.quickLogin){window.quickLogin.onChange(this);}" placeholder="Login" title="Your login" type="text" value="" />
      <script type='text/javascript' id='validate_Login'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['Login',1,'Enter login specified when signing up']);});mqGlobal.AddOnReady(function() {V.push(['Login',10,'Email cannot be used. Enter your login please',validateLogin]);}); /*]]>*/</script>
    </div>
    <!--[if lt IE 10]><div class="note">Password:</div><![endif]-->
    <div class="auth-form__box-input">
      <div class="input-with-show">
        <input autocomplete="off" class="input qa-password" id="Password" name="Password" onchange="if(window.quickLogin){window.quickLogin.onChange(this);}" placeholder="Password" title="Enter the password please" type="password" />
        <span class="input-with-show__icon" title="Show password" onclick="if(window.quickLogin){window.quickLogin.showPass(this, 'Show password', 'Hide password');}"></span>
      </div>
      <script type='text/javascript' id='validate_Password'>/*<![CDATA[*/ mqGlobal.AddOnReady(function() {V.push(['Password',1,'Please enter the password']);}); /*]]>*/</script>
    </div>
    <script type="text/javascript">
    function validateLogin(input) {
      return !/^\w+([-+.'']{1,2}\w+)* @\w+([-.]\w+)*\.\w+([-.]\w+)*$/i.test(input.value);
    }
    </script>
    <div class="forgot" id="loginForgotBlock"><a id="loginForgotLink" href="https://www.mql5.com/en/auth_forgotten?return=popup">Forgot your login/password?</a></div>
    <input type="submit" class="button button_yellow qa-submit" id="loginSubmit" value="Log in" title="Enter">
</form></div>

  <div class="auth-social" id="authSocialBlock">
    <ul class="auth-social-list" id="socialList">
      <li><a onclick="window.fpush({name: 'MQL5+Popup+Login+Google', unit: 'section', value: 'Forum'}); " href="https://www.mql5.com/en/auth_oauth2?provider=Google&amp;amp;return=popup" class="auth-soc-button qa-google-button auth-soc-button_google" rel="nofollow">Log in With Google</a></li>
    </ul>
  </div>

        </div>
      </div>
    </div>
  </div>
</div>
<script id="popupSection" type="application/json">{"section": "Forum"}</script>
<script id="popupTranslate" data-type="translate" type="application/json">
{
  "popup":
  {
  "EmailTitle" : "The password has been sent to {0}",
  "EmailDescription" : "Log in using the obtained password and the login specified during the registration",
  "SubmitButtonText" : "Activate account",
  "RegistrationTip" : "If you have not received the password email, check the spam folder or &lt;a href={0}&gt;repeat the registration&lt;/a&gt;"
  }
}
</script>

    





  </article>



<div aria-hidden="true" class="footer  desktop" id="footer">
  <ul class="links  links_desktop">
      <li id="navFooterCommunity">
        <nav>
          <ul>
            <li><a href="https://web.metatrader.app/terminal?mode=demo&amp;lang=en" target="_blank" rel="nofollow noopener" data-fz-event="MQL5+Footer+Trading">Online trading / WebTerminal</a></li>
            <li><a href="/en/code" data-fz-event="MQL5+Footer+CodeBase">Free technical indicators and robots</a></li>
            <li><a href="/en/articles" data-fz-event="MQL5+Footer+Articles">Articles about programming and trading</a></li>
            <li><a href="/en/job" data-fz-event="MQL5+Footer+Job">Order trading robots on the Freelance</a></li>
            <li><a href="/en/market" data-fz-event="MQL5+Footer+Market">Market of Expert Advisors and applications&#x9;</a></li>
            <li><a href="/en/signals" data-fz-event="MQL5+Footer+Signals">Follow forex signals</a></li>
            <li><a href="/en/vps" data-fz-event="MQL5+Footer+VPS">Low latency forex VPS</a></li>
            <li><a href="/en/forum" data-fz-event="MQL5+Footer+Forum">Traders forum</a></li>
            <li><a href="/en/blogs" data-fz-event="MQL5+Footer+Blogs">Trading blogs</a></li>
            <li><a rel="nofollow" href="/en/charts" data-fz-event="MQL5+Footer+Charts">Charts</a></li>
            <li><a href="/en/widgets" data-fz-event="MQL5+Footer+Widgets">Free widgets</a></li>
          </ul>
        </nav>
      </li>
      <li id="navFooterMt5">
        <nav>
          <ul>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> Trading Platform</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/releasenotes" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> latest updates</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/news" data-fz-event="MQL5+Footer+MetaTrader+5">News, implementations and technology</a></li>
            <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help" data-fz-event="MQL5+Footer+MetaTrader+5"><span class="nobr">MetaTrader 5</span> User Manual</a></li>
            <li><a href="/en/docs" data-fz-event="MQL5+Footer+Docs">MQL5 language of trading strategies</a></li>
            <li><a rel="nofollow noopener" href="https://cloud.mql5.com" data-fz-event="MQL5+Footer+Cloud">MQL5 Cloud Network</a></li>
            <li><a rel="noopener" href="https://forge.mql5.io/?lang=en" data-fz-event="MQL5+Footer+Forge" target="_blank">MQL5 Algo Forge</a></li>
              <li><a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_source=www.mql5.com&amp;utm_campaign=download" data-fz-event="MetaTrader+5+Desktop+Download+Footer">Download <span class="nobr">MetaTrader 5</span></a></li>
              <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help/start_advanced/installation" data-fz-event="MQL5+Footer+MetaTrader+5">Install Platform</a></li>
              <li><a rel="nofollow noopener" href="https://www.metatrader5.com/en/terminal/help/start_advanced/deinstallation" data-fz-event="MQL5+Footer+MetaTrader+5">Uninstall Platform</a></li>
          </ul>
        </nav>

      </li>
    <li id="navFooterWebsite">
        <nav>
          <ul>
            <li><a rel="nofollow" href="/en/about" data-fz-event="MQL5+Footer+About">About</a></li>
              <li><a href="/en/wall" data-fz-event="MQL5+Footer+Wall">Timeline</a></li>
            <li><a rel="nofollow" href="/en/about/terms" data-fz-event="MQL5+Footer+About">Terms and Conditions</a></li>
            <li><a rel="nofollow" href="/en/about/autopayments" data-fz-event="MQL5+Footer+About">Recurring Payment Agreement</a></li>
            <li><a rel="nofollow" href="/en/about/agencyagreement" data-fz-event="MQL5+Footer+About">Agency Agreement – Offer</a></li>
            <li><a rel="nofollow" href="/en/about/privacy" data-fz-event="MQL5+Footer+About">Privacy and Data Protection Policy</a></li>
            <li><a rel="nofollow" href="/en/about/cookies" data-fz-event="MQL5+Footer+About">Cookies Policy</a></li>
            <li>
                <a rel="nofollow" href="/en/contact" data-fz-event="MQL5+Footer+Contacts">Contacts and requests</a>
            </li>
          </ul>
        </nav>
    </li>

      <li>
        <div class="footer__products">
          <div class="footer__product">
            <a target="_blank" rel="nofollow noopener" href="https://www.metatrader5.com" class="footer__product-name">MetaTrader 5</a>
            <div class="footer__product-links">
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/mt5setup.exe?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon windows" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for Windows</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.ltd/mt5/MetaTrader5.pkg.zip?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon macos" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for MacOS</div></a>
            <a rel="nofollow noopener" href="https://www.mql5.com/en/articles/625?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon linux" data-fz-event="MetaTrader+5+Desktop+Download+Footer"><div class="footer__product-link-hint footer__product-link-hint-short">Download MetaTrader 5 for Linux</div></a>
            <a rel="nofollow noopener" href="https://web.metatrader.app/terminal?mode=demo&amp;lang=en" class="icon web"><div  class="footer__product-link-hint footer__product-link-hint-short">Open MetaTrader 5 WebTerminal</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/ios?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes&amp;hl=en" class="icon ios" data-fz-event="MetaTrader+5+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/jhZn8Ed1I1d.png)">Scan to install from App Store</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/android?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes&amp;hl=en" class="icon android" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/kiF2Io6W-9d.png)">Scan to install from Google Play</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mt5/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes" class="icon huawei" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/ZRt&#x2B;zI1l&#x2B;8O.png)">Scan to install from Huawei AppGallery</div></a>
            <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/mt5/metatrader5.apk?utm_source=www.mql5.com&amp;utm_campaign=install.metaquotes" class="icon ark" data-fz-event="MetaTrader+5+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/L0Q9oag&#x2B;3eE.png)">Scan to get Android APK file</div></a>
            </div>
          </div>
          <div>
            <div class="footer__product">
              <a target="_blank" rel="nofollow noopener" href="https://www.metatrader5.com/en/news/2270" class="footer__product-name">MQL5 Channels</a>
              <div class="footer__product-links">
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/ios?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon ios" data-fz-event="MQL5+Channels+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/bZVfOJnYpcO.png)">Scan to install from App Store</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/android?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon android" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/32MJFgw7BVs.png)">Scan to install from Google Play</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/mql5.channels/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon huawei" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/Su&#x2B;fe4n374e.png)">Scan to install from Huawei AppGallery</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/mql5channels/mql5channels.apk?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon ark" data-fz-event="MQL5+Channels+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/G6Mg4NfCPzO.png)">Scan to get Android APK file</div></a>
              </div>
            </div>
            <div class="footer__product">
              <a target="_blank" rel="nofollow noopener" href="https://www.tradays.com/en/download?utm_source=www.mql5.com&amp;utm_campaign=download" data-fz-event="MQL5+Footer+Download+Tradays" class="footer__product-name">Economic Calendar</a>
              <div class="footer__product-links">
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/ios?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon ios" data-fz-event="Tradays+iOS+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/CpD&#x2B;mhIw-1E.png)">Scan to install from App Store</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/android?utm_source=www.mql5.com&amp;utm_campaign=download&amp;hl=en" class="icon android" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/Bgyx8UcmYap.png)">Scan to install from Google Play</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/mobile/tradays/android/app-gallery?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon huawei" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/CrS7bbDAdAO.png)">Scan to install from Huawei AppGallery</div></a>
              <a rel="nofollow noopener" href="https://download.terminal.free/cdn/web/metaquotes.software.corp/tradays/tradays.apk?utm_source=www.mql5.com&amp;utm_campaign=download" class="icon ark" data-fz-event="Tradays+Android+Download+Footer"><div class="footer__product-link-hint" style="background-image: url(https://c.mql5.com/qr/VZi8YPIb2op.png)">Scan to get Android APK file</div></a>
              </div>
            </div>
          </div>
        </div>

        <div class="footer__networks">
          <a href="https://www.facebook.com/mql5.community/" target="_blank" rel="nofollow" title="Facebook"><i class="icons-networks icons-networks_fb"></i></a>
          <a href="https://t.me/mql5dev" target="_blank" rel="nofollow" title="Telegram"><i class="icons-networks icons-networks_tg"></i></a>
          <a href="https://x.com/mql5com" target="_blank" rel="nofollow" title="X (Twitter)"><i class="icons-networks icons-networks_tw"></i></a>
          <a href="https://www.youtube.com/@MetaQuotesOfficial" target="_blank" rel="nofollow" title="YouTube"><i class="icons-networks icons-networks_yt"></i></a>
          <a href="https://www.linkedin.com/company/mql5" target="_blank" rel="nofollow" title="LinkedIn"><i class="icons-networks icons-networks_linkedin"></i></a>
          <span>Subscribe to algotrading news</span>
        </div>
  
        <div class="footer__other">
          <div class="footer__not-a-broker">Not a broker, no real trading accounts</div>
          <div class="copyright">35 Dodekanisou str, Germasogeia, 4043,&nbsp;Limassol,&nbsp;Cyprus</div>
          <div class="copyright">Copyright 2000-2026, <span class="nobr">MetaQuotes Ltd</span></div>
        </div>
      </li>
  </ul>
</div>



<div class="shadow-layer" id="layer"></div>
    


  

  <div class="b-fixed-mt" id="bFixedMt" style="display: none;">
    
  </div>


<script type='text/javascript'>
		(function (a, e, f, g, b, c, d) { a[b] || (a.FintezaCoreObject = b, a[b] = a[b] || function () { (a[b].q = a[b].q || []).push(arguments) }, a[b].l = 1 * new Date, c = e.createElement(f), d = e.getElementsByTagName(f)[0], c.async = !0, c.defer = !0, c.src = g, d && d.parentNode && d.parentNode.insertBefore(c, d)) })
      (window, document, "script", "/ff/core.js", "fz");
		window.fz("register", "website", {
      id: "sqjxkxkswybhifrohpyooonwgbvsfzmayq",
			trackLinks: true
		});
        mqGlobal.AddOnReady(function () { Mql5Cookie.init('mql5.com', '5045831608106676662'); });
function editCommentInline(commentId){if(!window.editComment)return false;return editComment(commentId);}function quoteInline(commentId){if(!window.quote_forum)return false;return quote_forum(commentId);}function complaintInline(itemId,moduleId,typeId,parentModuleId){if(!window.showComplaintForm)return false;return showComplaintForm(itemId,moduleId,typeId,parentModuleId,'c7b04c1dc6a36945d64465254b1d8e63');}mqGlobal.AddOnReady(function(){if(!window.translateManager){window.translateManager=new Translate(undefined,'Error: failed to translate. Please try again later.');}TimeTagProcessor();if(!window.shareManager){window.shareManager=new Share();}window.Pocket=new PocketManager();if(document.querySelectorAll){var translateElements=document.querySelectorAll(".translateMenu");if(translateElements){var i=0,count=translateElements.length;for(i;i<count;i++){(function(i){var contentid=dataset(translateElements[i],"contentid"),sourcelang=dataset(translateElements[i],"sourcelang"),targetlang=dataset(translateElements[i],"targetlang"),moduleid=parseInt(dataset(translateElements[i],"moduleid")),typeid=parseInt(dataset(translateElements[i],"typeid")),entityid=parseInt(dataset(translateElements[i],"entityid"));Core.AddHandler(translateElements[i],"mouseover",function(){return translateManager.SetMenu(this,contentid,sourcelang,targetlang,moduleid,typeid,entityid);});})(i);}}}});function quoteTopicInline(itemId){if(!window.quote_forum)return false;return quote_forum(itemId);}function complaintTopicInline(itemId,moduleId,typeId,parentModuleId){if(!window.showComplaintForm)return false;return showComplaintForm(itemId,moduleId,typeId,parentModuleId,'ca971e3c410855ee218d9e5128d9f317');};window.lightBoxPhrases={};lightBoxPhrases.close='Close';lightBoxPhrases.collapse='Collapse';lightBoxPhrases.showOriginal='Show original';lightBoxPhrases.errorLoading='Unable to download attachment';lightBoxPhrases.next='Next';lightBoxPhrases.previous='Previous';lightBoxPhrases.save='Open';lightBoxPhrases.linkToImg='Link to the image';mqGlobal.AddOnLoad(function(){if(!window.likes){window.likes=new Likes();}});mqGlobal.AddOnLoad(function(){window.tooltipUserInfo.init();});mqGlobal.AddOnReady(function(){window.PopupRegisterquickRegistration=new QuickRegistration('PopupRegister','Popup+Register','Forum');});function validate_username(input){var reg=/^([a-z0-9]){1}([\-._a-z0-9]){1,30}([\-_a-z0-9]){1}$/i,value=input.value,result=true;if(reg.test(value)){result=true;}else{result=false;window.fpush({name:'MQL5+Popup+Register+Invalid+Login',unit:'section',value:'Forum'});}return result;}function validate_email(input){var reg=/^\w+([-+.'']{1,2}\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/i,value=input.value,result=true,length_value=value.length;if(reg.test(value)&&length_value>=1&&length_value<=40){result=true;}else{result=false;window.fpush({name:'MQL5+Popup+Register+Invalid+Email',unit:'section',value:'Forum'});}return result;};mqGlobal.AddOnReady(function(){var username=$('PopupRegisterusername'),email=$('PopupRegisteremail');if(username)username.value='';if(email)email.value='';});mqGlobal.AddOnReady(function(){window.quickLogin=new QuickLogin('Popup+Login','Forum');});mqGlobal.AddOnLoad(function(){window.forumPopup();});mqGlobal.AddOnReady(function(){{window.initHeaderSearch('','https://www.mql5.com/en/search');}});</script><script type="text/javascript">mqGlobal.AddOnReady(function(){window.initSuggestions("headerSearchKeyword","en","https://search.mql5.com/api/query","https://www.mql5.com/en/users_search/suggestion");});window.fz("show","bfogggabsofabcpxuzmgaibarmaxasdrj");mqGlobal.AddOnReady(function(){window.floatVerticalPanelNode=FloatVerticalPanel('This website uses cookies. Learn more about our <a href="/en/about/cookies">Cookies Policy</a>.','cookie_accept');});mqGlobal.AddOnReady(function(){window.initAddCopyButtonsToCodes('Copy to Clipboard');});							if (typeof Attach !== "undefined")
			Attach.setAcceptFilter(".zip, .txt, .log, .mqh, .ex5, .mq5, .mq4, .mqproj, .ex4, .mt5, .set, .tpl, .cl, .py, .sqlite, .csv, .ini, .ipynb, .onnx, .gif, .png, .jpg, .jpeg, .webp, .mp4, .webm");
	</script>

<script type="application/ld&#x2B;json">
		[
			{
				"@context": "https://schema.org",
				"@type": "Organization",
				"url": "https://www.mql5.com",
				"logo": "https://c.mql5.com/i/community/logo_mql5-2.png",
				"sameAs": [
					"https://www.facebook.com/mql5.community",
					"https://www.x.com/mql5com",
					"https://www.youtube.com/user/MetaQuotesOfficial"
				 ]
			}
		
, 
{"@context":"https://schema.org","@type":"ItemList","itemListElement":[{"@type":"SiteNavigationElement","position":1,"name":"Forum","description":"Discussions of trading strategies and algorithmic trading. MQL5.community  the largest forex forum","url":"https://www.mql5.com/en/forum","children":[]},{"@type":"SiteNavigationElement","position":2,"name":"Market","description":"MetaTrader Market - a Market of trading robots, indicators, trading books and magazines","url":"https://www.mql5.com/en/market","children":[]},{"@type":"SiteNavigationElement","position":3,"name":"Signals","description":"Social trading, copy trading and account monitoring with MetaTrader - Trading Signals on MQL5.com","url":"https://www.mql5.com/en/signals","children":[]},{"@type":"SiteNavigationElement","position":4,"name":"Freelance","description":"Order trading robots, technical indicators and algorithmic trading applications. Forex jobs. Freelance on MQL5.com. Hire MetaTrader experts and specialists","url":"https://www.mql5.com/en/job","children":[]},{"@type":"SiteNavigationElement","position":5,"name":"Quotes","description":"","url":"https://www.mql5.com/en/quotes/overview","children":[]},{"@type":"SiteNavigationElement","position":6,"name":"MetaTrader","description":"","url":"https://www.metatrader.com","children":[]},{"@type":"SiteNavigationElement","position":7,"name":"WebTerminal","description":"WebTerminal for the MetaTrader trading platform. Online forex trading.","url":"https://web.metatrader.app/terminal?mode=demo","children":[]},{"@type":"SiteNavigationElement","position":8,"name":"Calendar","description":"","url":"https://www.mql5.com/en/economic-calendar","children":[]},{"@type":"SiteNavigationElement","position":9,"name":"VPS","description":"","url":"https://www.mql5.com/en/vps","children":[]},{"@type":"SiteNavigationElement","position":10,"name":"Articles","description":"","url":"https://www.mql5.com/en/articles","children":[]},{"@type":"SiteNavigationElement","position":11,"name":"CodeBase","description":"Download trading robots, technical indicators and scripts with source code - MQL5 Code Base for MetaTrader 5","url":"https://www.mql5.com/en/code","children":[]},{"@type":"SiteNavigationElement","position":12,"name":"Algo Forge","description":"","url":"https://forge.mql5.io","children":[]},{"@type":"SiteNavigationElement","position":13,"name":"Documentation","description":"MetaQuotes Language 5 (MQL5) Reference - Documentation on MQL5.com","url":"https://www.mql5.com/en/docs","children":[]}]}		
,
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"item":"https://www.mql5.com/en/forum","name":"MQL5 Algo Trading community  forex forum for traders and developers"},{"@type":"ListItem","position":2,"item":"https://www.mql5.com/en/forum/ea","name":"Expert Advisors and Automated Trading"},{"@type":"ListItem","position":3,"name":"Getting Contract Specification Session Start / End times using MQL"}]}
,
{"@context":"https://schema.org","@type":"DiscussionForumPosting","headline":"Getting Contract Specification Session Start / End times using MQL","url":"https://www.mql5.com/en/forum/367885","datePublished":"2021-04-24T10:11:44.0000000Z","text":"Hi, &nbsp; &nbsp; Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL. Regards Vivek ","interactionStatistic":{"@type":"InteractionCounter","interactionType":"https://schema.org/LikeAction","userInteractionCount":0},"author":{"@type":"Person","name":"AnkaSoftware","url":"https://www.mql5.com/en/users/ankasoftware","agentInteractionStatistic":{"@type":"InteractionCounter","interactionType":"https://schema.org/WriteAction","userInteractionCount":157}},"comment":[{"@type":"Comment","text":" AnkaSoftware : Is it possible to get Contract Specification Session Start / End times ( as shown in the enclosed screenshot ) using MQL. EDIT2: The Session Information is available via the SymbolInfoSessionQuote / SymbolInfoSessionTrade funtions. Most other details should be available via the Symbol Properties and the use of the SymbolInfo functions. EDIT3: There is also the Market Information functions for other info. ","datePublished":"2021-04-24T10:11:44.0000000Z","url":"https://www.mql5.com/en/forum/367885#comment_22008077","author":{"@type":"Person","name":"Fernando Carreiro","url":"https://www.mql5.com/en/users/fmic","agentInteractionStatistic":{"@type":"InteractionCounter","interactionType":"https://schema.org/WriteAction","userInteractionCount":39991}}}]}
		]
	</script>
</body>
</html>
