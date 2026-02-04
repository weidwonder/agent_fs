using ExcelConverter.JsonRpc;
using OfficeOpenXml;

ExcelPackage.License.SetNonCommercialPersonal("agent-fs");

var server = new JsonRpcServer();
await server.RunAsync();
