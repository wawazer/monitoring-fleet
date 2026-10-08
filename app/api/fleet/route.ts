export async function GET() {

  return Response.json({
    success:true,
    message:"Fleet API aktif",
    time:new Date()
  });

}


export async function POST(request:Request){

  try {

    const body = await request.json();

    console.log("P-CAR DATA:", body);


    return Response.json({

      success:true,
      message:"Data P-CAR berhasil diterima",

      units:
        body.data?.units?.length || 0,

      updated_at:
        body.data?.updated_at || null

    });


  } catch(error){

    return Response.json({

      success:false,

      error:
        error instanceof Error
        ? error.message
        : String(error)

    },{
      status:500
    });

  }

}