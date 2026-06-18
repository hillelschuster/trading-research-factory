#property strict

#include "..\\include\\TrfFileCommonBridge.mqh"

input string InpRunId="";
input int InpSequence=1;
input string InpOutputPath="";

int OnInit()
  {
   if(InpRunId=="")
     {
      Print("TRF FILE_COMMON smoke blocked: InpRunId is required.");
      return(INIT_PARAMETERS_INCORRECT);
     }

   string final_name=InpOutputPath;
   if(final_name=="")
      final_name=StringFormat("trf_bridge\\%s\\mql5_smoke_%d.json",InpRunId,InpSequence);
   string tmp_name=final_name+".tmp";
   string payload=StringFormat("{\"schema_version\":\"%s\",\"run_id\":\"%s\",\"sequence\":%d,\"producer\":\"mql5_file_common_smoke\",\"network_calls_required\":false}",TRF_FILE_COMMON_SCHEMA,InpRunId,InpSequence);
   string error_message="";

   if(!TrfWriteFileCommonText(tmp_name,final_name,payload,error_message))
     {
      Print(error_message);
      return(INIT_FAILED);
     }

   PrintFormat("TRF FILE_COMMON smoke wrote %s",final_name);
   return(INIT_SUCCEEDED);
  }

void OnTick()
  {
  }
