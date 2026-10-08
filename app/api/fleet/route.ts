let fleetData:any = null;


// GET
export async function GET() {

  return Response.json({

    success:true,

    message:"Fleet API aktif",

    updated_at:
      fleetData?.updated_at || null,

    units:
      fleetData?.units?.length || 0

  });

}



// POST
export async function POST(request:Request){

  try {


    const body = await request.json();


    console.log(
      "P-CAR DATA MASUK:",
      JSON.stringify(body,null,2)
    );


    if(!body.data){

      return Response.json({

        success:false,

        message:"Format data harus {data:{...}}"

      },{
        status:400
      });

    }



    fleetData = body.data;



    return Response.json({

      success:true,

      message:"Data fleet berhasil disimpan",

      units:
        fleetData.units?.length || 0,


      updated_at:
        fleetData.updated_at || null


    });



  }catch(error){


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