#property strict

#include <Trade\Trade.mqh>
#include "..\include\TrfFileCommonBridge.mqh"

input string InpRunId="RUN-MT5-TESTER-LIFECYCLE-BENCH";
input int InpSequence=1;
input string InpOutputPath="";
input string InpSettingsSha256="";
input string InpTickModel="configured_by_terminal_tester_ini";
input double InpLots=0.01;

#define TRF_MAGIC 26050301

CTrade trade;
int stage=0;
int ticks_seen=0;
bool output_written=false;
bool market_opened=false;
bool market_closed=false;
bool pending_placed=false;
bool pending_removed=false;
bool hard_exit_seen=false;
ulong pending_ticket=0;
uint market_open_retcode=0;
uint market_close_retcode=0;
uint pending_place_retcode=0;
uint pending_remove_retcode=0;
int transaction_count=0;
int deal_add_count=0;
int order_add_count=0;
int order_delete_count=0;
string lifecycle_log="";

string JsonBool(const bool value)
  {
   return(value ? "true" : "false");
  }

string JsonString(string value)
  {
   StringReplace(value,"\\","\\\\");
   StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r","\\r");
   StringReplace(value,"\n","\\n");
   return("\""+value+"\"");
  }

void AddLog(const string message)
  {
   if(lifecycle_log!="")
      lifecycle_log+=",";
   lifecycle_log+=JsonString(message);
   Print(message);
  }

double BenchVolume()
  {
   double min_volume=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double max_volume=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double volume=MathMax(InpLots,min_volume);
   volume=MathMin(volume,max_volume);
   if(step>0)
      volume=MathFloor(volume/step)*step;
   return(NormalizeDouble(MathMax(volume,min_volume),2));
  }

bool RetcodeDone(const uint retcode)
  {
   return(retcode==TRADE_RETCODE_DONE || retcode==TRADE_RETCODE_DONE_PARTIAL || retcode==TRADE_RETCODE_PLACED);
  }

bool SelectBenchPosition()
  {
   for(int i=PositionsTotal()-1;i>=0;i--)
     {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0)
         continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==TRF_MAGIC)
         return(true);
     }
   return(false);
  }

bool PlacePendingOrder()
  {
   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   int stop_level=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   int offset=MathMax(stop_level+20,100);
   double price=NormalizeDouble(SymbolInfoDouble(_Symbol,SYMBOL_ASK)-offset*point,digits);
   bool sent=trade.BuyLimit(BenchVolume(),price,_Symbol,0,0,ORDER_TIME_GTC,0,"trf_pending_place");
   pending_place_retcode=trade.ResultRetcode();
   pending_ticket=trade.ResultOrder();
   AddLog(StringFormat("pending_order place sent=%s retcode=%u order=%I64u price=%s",sent ? "true" : "false",pending_place_retcode,pending_ticket,DoubleToString(price,digits)));
   return(sent && RetcodeDone(pending_place_retcode) && pending_ticket>0);
  }

void WriteLifecycleOutput()
  {
   if(output_written)
      return;

   string run_id=InpRunId=="" ? "RUN-MT5-TESTER-LIFECYCLE-BENCH" : InpRunId;
   string final_name=InpOutputPath;
   if(final_name=="")
      final_name=StringFormat("trf_tester\\%s\\lifecycle_%d.json",run_id,InpSequence);

   bool market_observed=market_opened && market_closed;
   bool pending_observed=pending_placed && pending_removed;
   bool exit_observed=hard_exit_seen;
   string payload="{";
   payload+="\"schema_version\":\"mt5_tester_lifecycle_output_v1\",";
   payload+="\"run_id\":"+JsonString(run_id)+",";
   payload+=StringFormat("\"sequence\":%d,",InpSequence);
   payload+="\"producer\":\"mql5_tester_lifecycle_bench\",";
   payload+="\"tester_settings\":{";
   payload+=StringFormat("\"terminal_build\":%d,",(int)TerminalInfoInteger(TERMINAL_BUILD));
   payload+="\"terminal_name\":"+JsonString(TerminalInfoString(TERMINAL_NAME)) + ",";
   payload+="\"symbol\":"+JsonString(_Symbol)+",";
   payload+="\"timeframe\":"+JsonString(EnumToString(_Period))+",";
   payload+="\"tick_model\":"+JsonString(InpTickModel)+",";
   payload+="\"spread_source\":\"strategy_tester_configuration\",";
   payload+="\"commission_model\":\"strategy_tester_account_or_symbol_settings\",";
   payload+="\"swap_model\":\"strategy_tester_account_or_symbol_settings\",";
   payload+="\"execution_delay\":\"strategy_tester_configuration\",";
   payload+="\"deposit_currency\":"+JsonString(AccountInfoString(ACCOUNT_CURRENCY))+",";
   payload+=StringFormat("\"account_login\":%I64d,",AccountInfoInteger(ACCOUNT_LOGIN));
   payload+=StringFormat("\"leverage\":%d,",(int)AccountInfoInteger(ACCOUNT_LEVERAGE));
   payload+=StringFormat("\"margin_mode\":%d,",(int)AccountInfoInteger(ACCOUNT_MARGIN_MODE));
   payload+="\"settings_sha256\":"+JsonString(InpSettingsSha256)+"},";
   payload+="\"lifecycle_summary\":{";
   payload+=StringFormat("\"market_order\":{\"observed\":%s,\"opened\":%s,\"closed\":%s,\"open_retcode\":%u,\"close_retcode\":%u},",JsonBool(market_observed),JsonBool(market_opened),JsonBool(market_closed),market_open_retcode,market_close_retcode);
   payload+=StringFormat("\"pending_order\":{\"observed\":%s,\"placed\":%s,\"cancelled\":%s,\"triggered\":false,\"place_retcode\":%u,\"remove_retcode\":%u},",JsonBool(pending_observed),JsonBool(pending_placed),JsonBool(pending_removed),pending_place_retcode,pending_remove_retcode);
   payload+=StringFormat("\"exit_order\":{\"observed\":%s,\"sl_or_tp_seen\":false,\"hard_exit_seen\":%s,\"retcode\":%u}},",JsonBool(exit_observed),JsonBool(hard_exit_seen),market_close_retcode);
   payload+="\"transactions\":{";
   payload+=StringFormat("\"total\":%d,\"deal_add\":%d,\"order_add\":%d,\"order_delete\":%d},",transaction_count,deal_add_count,order_add_count,order_delete_count);
   payload+="\"limitations\":{";
   payload+="\"tester_conditioned\":true,\"not_forward_evidence\":true,\"fixture_output\":false,\"real_strategy_tester_output\":true,\"not_candidate_strategy\":true,\"manual_copy_required\":false},";
   payload+="\"logs\":["+lifecycle_log+"]}";

   string error_message="";
   if(!TrfWriteFileCommonText(final_name+".tmp",final_name,payload,error_message))
      Print(error_message);
   else
     {
      output_written=true;
      PrintFormat("TRF tester lifecycle bench wrote %s",final_name);
     }
  }

int OnInit()
  {
   if(!MQLInfoInteger(MQL_TESTER))
     {
      Print("TRF tester lifecycle bench is intended for Strategy Tester execution.");
      return(INIT_FAILED);
     }
   trade.SetExpertMagicNumber(TRF_MAGIC);
   trade.SetMarginMode();
   trade.SetTypeFillingBySymbol(_Symbol);
   trade.SetDeviationInPoints(20);
   AddLog("tester lifecycle bench initialized");
   return(INIT_SUCCEEDED);
  }

void OnTick()
  {
   ticks_seen++;
   if(stage==0)
     {
      bool sent=trade.Buy(BenchVolume(),_Symbol,0,0,0,"trf_market_open");
      market_open_retcode=trade.ResultRetcode();
      market_opened=sent && RetcodeDone(market_open_retcode);
      AddLog(StringFormat("market_order open sent=%s retcode=%u",sent ? "true" : "false",market_open_retcode));
      stage=1;
      return;
     }
   if(stage==1)
     {
      if(SelectBenchPosition())
        {
         bool sent=trade.PositionClose(_Symbol,20);
         market_close_retcode=trade.ResultRetcode();
         market_closed=sent && RetcodeDone(market_close_retcode);
         hard_exit_seen=market_closed;
         AddLog(StringFormat("market_order hard_exit sent=%s retcode=%u",sent ? "true" : "false",market_close_retcode));
        }
      else
         AddLog("market_order close skipped because bench position was not selected");
      stage=2;
      return;
     }
   if(stage==2)
     {
      pending_placed=PlacePendingOrder();
      stage=3;
      return;
     }
   if(stage==3)
     {
      if(pending_ticket>0)
        {
         bool sent=trade.OrderDelete(pending_ticket);
         pending_remove_retcode=trade.ResultRetcode();
         pending_removed=sent && RetcodeDone(pending_remove_retcode);
         AddLog(StringFormat("pending_order remove sent=%s retcode=%u order=%I64u",sent ? "true" : "false",pending_remove_retcode,pending_ticket));
        }
      else
         AddLog("pending_order remove skipped because no pending ticket was recorded");
      stage=4;
      WriteLifecycleOutput();
      ExpertRemove();
     }
  }

void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result)
  {
   transaction_count++;
   if(trans.type==TRADE_TRANSACTION_DEAL_ADD)
      deal_add_count++;
   if(trans.type==TRADE_TRANSACTION_ORDER_ADD)
      order_add_count++;
   if(trans.type==TRADE_TRANSACTION_ORDER_DELETE)
      order_delete_count++;
  }

void OnDeinit(const int reason)
  {
   AddLog(StringFormat("tester lifecycle bench deinit reason=%d ticks=%d",reason,ticks_seen));
   WriteLifecycleOutput();
  }
