#property strict

#define TRF_FILE_COMMON_SCHEMA "mt5_file_common_message_v1"

bool TrfWriteFileCommonText(const string tmp_name,const string final_name,const string text,string &error_message)
  {
   ResetLastError();
   int handle=FileOpen(tmp_name,FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_ANSI);
   if(handle==INVALID_HANDLE)
     {
      error_message=StringFormat("FileOpen failed for %s, error=%d",tmp_name,GetLastError());
      return(false);
     }

   FileWriteString(handle,text);
   FileFlush(handle);
   FileClose(handle);

   ResetLastError();
   if(!FileMove(tmp_name,FILE_COMMON,final_name,FILE_COMMON|FILE_REWRITE))
     {
      error_message=StringFormat("FileMove failed from %s to %s, error=%d",tmp_name,final_name,GetLastError());
      return(false);
     }

   return(true);
  }
